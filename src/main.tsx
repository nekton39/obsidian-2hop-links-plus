import { CachedMetadata, MarkdownView, Plugin, TFile, WorkspaceLeaf, ItemView } from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import { FileEntity } from "./model/FileEntity";
import { TwohopLink } from "./model/TwohopLink";
import TwohopLinksRootView from "./ui/TwohopLinksRootView";
import { TagLinks } from "./model/TagLinks";
import { path2linkText, removeBlockReference } from "./utils";
import {
  DEFAULT_SETTINGS,
  TwohopPluginSettings,
  TwohopSettingTab,
} from "./Settings";

const CONTAINER_CLASS = "twohop-links-container";
export const HOVER_LINK_ID = "2hop-links";

declare module "obsidian" {
  interface Workspace {
    on(eventName: "layout-ready", callback: () => any, ctx?: any): EventRef;
  }
}

export default class TwohopLinksPlugin extends Plugin {
  settings: TwohopPluginSettings;
  enabled: boolean;

  async onload(): Promise<void> {
    console.debug("------ loading obsidian-twohop-links plugin");

    await this.loadSettings();

    this.enabled = true;

    this.app.workspace.on("file-open", async () => {
      if (this.enabled) {
        await this.renderTwohopLinks();
      }
    });

    this.app.metadataCache.on("resolve", async (file) => {
      if (this.enabled) {
        const activeFile: TFile = this.app.workspace.getActiveFile();
        if (activeFile != null) {
          if (file.path == activeFile.path) {
            await this.renderTwohopLinks();
          }
        }
      }
    });

    this.addSettingTab(new TwohopSettingTab(this.app, this));

    this.registerView("TwoHopLinksView", (leaf: WorkspaceLeaf) => new TwoHopLinksView(leaf, this));

    this.updateTwoHopLinksView();
  }

  async updateTwoHopLinksView() {
    if (this.settings.showTwoHopLinksInSeparatePane) {
      if (!this.isTwoHopLinksViewOpen()) {
        this.openTwoHopLinksView();
      } else {
        this.updateOpenTwoHopLinksView();
      }
      this.disable(false);
    } else {
      if (this.isTwoHopLinksViewOpen()) {
        this.closeTwoHopLinksView();
      }
      await this.renderTwohopLinks();
      this.enable(false);
    }
  }

  async initTwoHopLinksView() {
    if (!this.isTwoHopLinksViewOpen()) {
      this.openTwoHopLinksView();
    } else {
      this.updateOpenTwoHopLinksView();
    }
  }

  async updateOpenTwoHopLinksView() {
    for (let leaf of this.app.workspace.getLeavesOfType("TwoHopLinksView")) {
      let view = leaf.view;
      if (view instanceof TwoHopLinksView) {
        await view.onOpen();
      }
    }
  }

  isTwoHopLinksViewOpen(): boolean {
    return this.app.workspace.getLeavesOfType("TwoHopLinksView").length > 0;
  }

  async openTwoHopLinksView() {
    const leaf = this.app.workspace.getLeftLeaf(false);
    leaf.setViewState({ type: "TwoHopLinksView" });
    this.app.workspace.revealLeaf(leaf);
  }

  closeTwoHopLinksView() {
    this.app.workspace.detachLeavesOfType("TwoHopLinksView");
  }

  enable(check: boolean): boolean {
    if (check) {
      return !this.enabled;
    }

    this.enabled = true;
    this.renderTwohopLinks().then(() =>
      console.debug("Rendered two hop links")
    );
    return true;
  }

  disable(check: boolean): boolean {
    if (check) {
      return this.enabled;
    }

    this.enabled = false;
    this.removeTwohopLinks();
    const container = this.app.workspace.containerEl.querySelector(
      ".twohop-links-container"
    );
    if (container) {
      ReactDOM.unmountComponentAtNode(container);
      container.remove();
    }
    (app.workspace as any).unregisterHoverLinkSource(HOVER_LINK_ID);
    return true;
  }

  removeTwohopLinks(): void {
    const markdownView: MarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (markdownView !== null) {
      for (const element of this.getContainerElements(markdownView)) {
        const container = element.querySelector("." + CONTAINER_CLASS);
        if (container) {
          container.remove();
        }
      }

      if (markdownView.previewMode !== null) {
        const previewElements = Array.from(markdownView.previewMode.containerEl.querySelectorAll("." + CONTAINER_CLASS));
        for (const element of previewElements) {
          element.remove();
        }
      }
    }
  }

  async gatherTwoHopLinks(activeFile: TFile): Promise<{
    forwardLinks: FileEntity[];
    newLinks: FileEntity[];
    backwardLinks: FileEntity[];
    unresolvedTwoHopLinks: TwohopLink[];
    resolvedTwoHopLinks: TwohopLink[];
    tagLinksList: TagLinks[];
  }> {

    const activeFileCache: CachedMetadata = this.app.metadataCache.getFileCache(activeFile);

    const { resolved: forwardLinks, new: newLinks } = await this.getForwardLinks(activeFile, activeFileCache);
    const forwardLinkSet = new Set<string>(forwardLinks.map((it) => it.key()));

    const unresolvedTwoHopLinks = await this.getTwohopLinks(
      activeFile,
      this.app.metadataCache.unresolvedLinks,
      forwardLinkSet
    );
    const resolvedTwoHopLinks = await this.getTwohopLinks(
      activeFile,
      this.app.metadataCache.resolvedLinks,
      forwardLinkSet
    );

    const backwardLinks = await this.getBackLinks(activeFile, forwardLinkSet);
    const tagLinksList = await this.getTagLinksList(activeFile, activeFileCache);

    return {
      forwardLinks,
      newLinks,
      backwardLinks,
      unresolvedTwoHopLinks,
      resolvedTwoHopLinks,
      tagLinksList
    };
  }

  async renderTwohopLinks(): Promise<void> {
    if (this.settings.showTwoHopLinksInSeparatePane) {
      return;
    }
    const markdownView: MarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = markdownView?.file;
    if (activeFile == null) {
      console.error('No active file');
      return;
    }

    const {
      forwardLinks,
      newLinks,
      backwardLinks,
      unresolvedTwoHopLinks,
      resolvedTwoHopLinks,
      tagLinksList
    } = await this.gatherTwoHopLinks(activeFile);

    for (const container of this.getContainerElements(markdownView)) {
      await this.injectTwohopLinks(
        forwardLinks,
        newLinks,
        backwardLinks,
        unresolvedTwoHopLinks,
        resolvedTwoHopLinks,
        tagLinksList,
        container
      );
    }
  }

  async renderTwohopLinksForView(activeFile: TFile): Promise<JSX.Element> {
    if (!this.settings.showTwoHopLinksInSeparatePane) {
      return;
    }
    const {
      forwardLinks,
      newLinks,
      backwardLinks,
      unresolvedTwoHopLinks,
      resolvedTwoHopLinks,
      tagLinksList
    } = await this.gatherTwoHopLinks(activeFile);

    return (
      <TwohopLinksRootView
        forwardConnectedLinks={forwardLinks}
        newLinks={newLinks}
        backwardConnectedLinks={backwardLinks}
        unresolvedTwoHopLinks={unresolvedTwoHopLinks}
        resolvedTwoHopLinks={resolvedTwoHopLinks}
        tagLinksList={tagLinksList}
        onClick={this.openFile.bind(this)}
        getPreview={this.readPreview.bind(this)}
        app={this.app}
        showForwardConnectedLinks={this.settings.showForwardConnectedLinks}
        showBackwardConnectedLinks={this.settings.showBackwardConnectedLinks}
        autoLoadTwoHopLinks={this.settings.autoLoadTwoHopLinks}
        initialBoxCount={this.settings.initialBoxCount}
        initialSectionCount={this.settings.initialSectionCount}
      />
    );
  }

  private getContainerElements(markdownView: MarkdownView): Element[] {
    if (this.settings.putOnTop) {
      const elements = markdownView.containerEl.querySelectorAll(
        ".markdown-source-view .CodeMirror-scroll, .markdown-preview-view, .markdown-source-view .cm-sizer"
      );
      console.debug(`getContainerElements: ${elements.length}`);

      const containers: Element[] = [];
      for (let i = 0; i < elements.length; i++) {
        const el = elements.item(i);
        const container: Element = ((): Element => {
          const e = el.querySelector("." + CONTAINER_CLASS);
          if (e) {
            return e;
          } else {
            const c = document.createElement("div");
            c.className = CONTAINER_CLASS;
            el.insertBefore(c, el.firstChild);
            return c;
          }
        })();
        containers.push(container);
      }
      console.debug(`Return container elements: ${containers.length}`);
      return containers;
    } else {
      const elements = markdownView.containerEl.querySelectorAll(
        ".markdown-source-view .CodeMirror-lines, .markdown-preview-view, .markdown-source-view .cm-sizer"
      );

      const containers: Element[] = [];
      for (let i = 0; i < elements.length; i++) {
        const el = elements.item(i);
        const container =
          el.querySelector("." + CONTAINER_CLASS) ||
          el.createDiv({ cls: CONTAINER_CLASS });
        containers.push(container);
      }
      return containers;
    }
  }

  private getSortFunction(sortOrder: string) {
    switch (sortOrder) {
      case 'filenameAsc':
        return (a: any, b: any) =>
          a.entity && b.entity ? a.entity.linkText.localeCompare(b.entity.linkText) : 0;
      case 'filenameDesc':
        return (a: any, b: any) =>
          a.entity && b.entity ? b.entity.linkText.localeCompare(a.entity.linkText) : 0;
      case 'modifiedDesc':
        return (a: any, b: any) => b.stat.mtime - a.stat.mtime;
      case 'modifiedAsc':
        return (a: any, b: any) => a.stat.mtime - b.stat.mtime;
      case 'createdDesc':
        return (a: any, b: any) => b.stat.ctime - a.stat.ctime;
      case 'createdAsc':
        return (a: any, b: any) => a.stat.ctime - b.stat.ctime;
    }
  }

  private getTwoHopSortFunction(sortOrder: string) {
    switch (sortOrder) {
      case 'filenameAsc':
        return (a: any, b: any) =>
          a.twoHopLinkEntity && b.twoHopLinkEntity ? a.twoHopLinkEntity.link.linkText.localeCompare(b.twoHopLinkEntity.link.linkText) : 0;
      case 'filenameDesc':
        return (a: any, b: any) =>
          a.twoHopLinkEntity && b.twoHopLinkEntity ? b.twoHopLinkEntity.link.linkText.localeCompare(a.twoHopLinkEntity.link.linkText) : 0;
      case 'modifiedDesc':
        return (a: any, b: any) => b.stat.mtime - a.stat.mtime;
      case 'modifiedAsc':
        return (a: any, b: any) => a.stat.mtime - b.stat.mtime;
      case 'createdDesc':
        return (a: any, b: any) => b.stat.ctime - a.stat.ctime;
      case 'createdAsc':
        return (a: any, b: any) => a.stat.ctime - b.stat.ctime;
    }
  }

  getTagLinksList = async (
    activeFile: TFile,
    activeFileCache: CachedMetadata
  ): Promise<TagLinks[]> => {
    if (activeFileCache.tags) {
      const activeFileTagSet = new Set(
        activeFileCache.tags.map((it) => it.tag)
      );
      const tagMap: Record<string, FileEntity[]> = {};
      const seen: Record<string, boolean> = {};
      for (const markdownFile of this.app.vault.getMarkdownFiles()) {
        if (markdownFile == activeFile) {
          continue;
        }
        const cachedMetadata =
          this.app.metadataCache.getFileCache(markdownFile);
        if (cachedMetadata && cachedMetadata.tags) {
          for (const tag of cachedMetadata.tags.filter((it) =>
            activeFileTagSet.has(it.tag)
          )) {
            if (!tagMap[tag.tag]) {
              tagMap[tag.tag] = [];
            }
            if (!seen[markdownFile.path]) {
              const linkText = path2linkText(markdownFile.path);
              tagMap[tag.tag].push(new FileEntity(activeFile.path, linkText));
              seen[markdownFile.path] = true;
            }
          }
        }
      }

      const tagLinksEntities = await Promise.all(
        Object.keys(tagMap).map(async (tag) => {
          const statsPromises = tagMap[tag].map(async (entity) => {
            const file = this.app.metadataCache.getFirstLinkpathDest(entity.linkText, entity.sourcePath);
            if (!file) {
              return null;
            }
            const stat = await this.app.vault.adapter.stat(file.path);
            return { entity, stat };
          });

          const stats = (await Promise.all(statsPromises)).filter((it) => it && it.entity && it.stat);

          const sortFunction = this.getSortFunction(this.settings.sortOrder);
          stats.sort(sortFunction);

          const sortedFileEntities = stats.map((it) => it!.entity);

          return { tag, fileEntities: sortedFileEntities };
        })
      );

      const tagLinksList: TagLinks[] = tagLinksEntities.map((it) => new TagLinks(it!.tag, it!.fileEntities));
      return tagLinksList;
    }
    return [];
  }

  private async injectTwohopLinks(
    forwardConnectedLinks: FileEntity[],
    newLinks: FileEntity[],
    backwardConnectedLinks: FileEntity[],
    unresolvedTwoHopLinks: TwohopLink[],
    resolvedTwoHopLinks: TwohopLink[],
    tagLinksList: TagLinks[],
    container: Element
  ) {
    const showForwardConnectedLinks = this.settings.showForwardConnectedLinks;
    const showBackwardConnectedLinks = this.settings.showBackwardConnectedLinks;
    ReactDOM.render(
      <TwohopLinksRootView
        forwardConnectedLinks={forwardConnectedLinks}
        newLinks={newLinks}
        backwardConnectedLinks={backwardConnectedLinks}
        unresolvedTwoHopLinks={unresolvedTwoHopLinks}
        resolvedTwoHopLinks={resolvedTwoHopLinks}
        tagLinksList={tagLinksList}
        onClick={this.openFile.bind(this)}
        getPreview={this.readPreview.bind(this)}
        app={this.app}
        showForwardConnectedLinks={showForwardConnectedLinks}
        showBackwardConnectedLinks={showBackwardConnectedLinks}
        autoLoadTwoHopLinks={this.settings.autoLoadTwoHopLinks}
        initialBoxCount={this.settings.initialBoxCount}
        initialSectionCount={this.settings.initialSectionCount}
      />,
      container
    );
  }

  private async openFile(fileEntity: FileEntity): Promise<void> {
    const linkText = removeBlockReference(fileEntity.linkText);

    console.debug(
      `Open file: linkText='${linkText}', sourcePath='${fileEntity.sourcePath}'`
    );
    const file = this.app.metadataCache.getFirstLinkpathDest(
      linkText,
      fileEntity.sourcePath
    );
    if (file == null) {
      if (!confirm(`Create new file: ${linkText}?`)) {
        console.log("Canceled!!");
        return;
      }
    }
    return this.app.workspace.openLinkText(
      fileEntity.linkText,
      fileEntity.sourcePath
    );
  }

  private shouldExcludePath(path: string): boolean {
    const excludePaths = this.settings.excludePaths;
    return excludePaths.some((excludePath: string) => {
      if (excludePath.endsWith("/")) {
        return path.startsWith(excludePath);
      } else {
        return path === excludePath;
      }
    });
  }

  private async getTwohopLinks(
    activeFile: TFile,
    links: Record<string, Record<string, number>>,
    forwardLinkSet: Set<string>
  ): Promise<TwohopLink[]> {
    const twoHopLinks: Record<string, FileEntity[]> = {};
    if (links[activeFile.path] == null) {
      return [];
    }
    const twohopLinkList = this.aggregate2hopLinks(activeFile, links);
    if (twohopLinkList == null) {
      return [];
    }

    let seenLinks = new Set<string>();

    for (const k of Object.keys(twohopLinkList)) {
      if (twohopLinkList[k].length > 0) {
        twoHopLinks[k] = twohopLinkList[k]
          .filter((it) => !this.shouldExcludePath(it))
          .map((it) => {
            const linkText = path2linkText(it);
            if (
              this.settings.enableDuplicateRemoval &&
              (forwardLinkSet.has(removeBlockReference(linkText)) ||
                seenLinks.has(linkText))
            ) {
              return null;
            }
            seenLinks.add(linkText);
            return new FileEntity(activeFile.path, linkText);
          })
          .filter((it) => it);
      }
    }

    const twoHopLinkEntities = (await Promise.all(
      Object.keys(links[activeFile.path])
        .filter((path) => !this.shouldExcludePath(path))
        .map(async (path) => {
          if (twoHopLinks[path]) {
            const statsPromises = twoHopLinks[path].map(async (entity) => {
              const file = this.app.metadataCache.getFirstLinkpathDest(entity.linkText, entity.sourcePath);
              if (!file) {
                return null;
              }
              const stat = await this.app.vault.adapter.stat(file.path);
              return { entity, stat };
            });

            const stats = (await Promise.all(statsPromises)).filter((it) => it && it.entity && it.stat);

            const sortFunction = this.getSortFunction(this.settings.sortOrder);
            stats.sort(sortFunction);

            const sortedFileEntities = stats.map((it) => it!.entity);

            return { link: new FileEntity(activeFile.path, path), fileEntities: sortedFileEntities };
          }
          return null;
        })
    )).filter(it => it);

    const twoHopLinkStatsPromises = twoHopLinkEntities.map(async (twoHopLinkEntity) => {
      const stat = await this.app.vault.adapter.stat(twoHopLinkEntity.link.linkText);
      return { twoHopLinkEntity, stat };
    });

    const twoHopLinkStats = (await Promise.all(twoHopLinkStatsPromises)).filter((it) => it && it.twoHopLinkEntity && it.stat);

    const twoHopSortFunction = this.getTwoHopSortFunction(this.settings.sortOrder);
    twoHopLinkStats.sort(twoHopSortFunction);

    return twoHopLinkStats.map((it) => new TwohopLink(it!.twoHopLinkEntity.link, it!.twoHopLinkEntity.fileEntities)).filter((it) => it.fileEntities.length > 0);
  }

  private aggregate2hopLinks(
    activeFile: TFile,
    links: Record<string, Record<string, number>>
  ): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    const activeFileLinks = new Set(Object.keys(links[activeFile.path]));

    for (const src of Object.keys(links)) {
      if (src == activeFile.path) {
        continue;
      }
      if (links[src] == null) {
        continue;
      }
      for (const dest of Object.keys(links[src])) {
        if (activeFileLinks.has(dest)) {
          if (!result[dest]) {
            result[dest] = [];
          }
          result[dest].push(src);
        }
      }
    }
    return result;
  }

  private async getForwardLinks(
    activeFile: TFile,
    activeFileCache: CachedMetadata
  ): Promise<{ resolved: FileEntity[], new: FileEntity[] }> {
    const resolvedLinks: FileEntity[] = [];
    const newLinks: FileEntity[] = [];

    if (activeFileCache != null && activeFileCache.links != null) {
      const seen = new Set<string>();

      for (const it of activeFileCache.links) {
        const key = removeBlockReference(it.link);
        if (!seen.has(key)) {
          seen.add(key);
          const targetFile = this.app.metadataCache.getFirstLinkpathDest(key, activeFile.path);

          if (targetFile && this.shouldExcludePath(targetFile.path)) {
            continue;
          }

          if (targetFile) {
            resolvedLinks.push(new FileEntity(targetFile.path, it.link));
          } else {
            newLinks.push(new FileEntity(activeFile.path, it.link));
          }
        }
      }

      const statsPromises = resolvedLinks.map(async (entity) => {
        const stat = await this.app.vault.adapter.stat(entity.sourcePath);
        return { entity, stat };
      });

      const stats = (await Promise.all(statsPromises)).filter((it) => it);

      const sortFunction = this.getSortFunction(this.settings.sortOrder);
      stats.sort(sortFunction);

      return {
        resolved: stats.map((it) => it!.entity),
        new: newLinks
      };
    } else {
      return { resolved: [], new: [] };
    }
  }

  private async getBackLinks(
    activeFile: TFile,
    forwardLinkSet: Set<string>
  ): Promise<FileEntity[]> {
    const name = activeFile.path;
    const resolvedLinks: Record<string, Record<string, number>> = this.app
      .metadataCache.resolvedLinks;
    const backLinkEntities: FileEntity[] = [];
    for (const src of Object.keys(resolvedLinks)) {
      if (this.shouldExcludePath(src)) {
        continue;
      }
      for (const dest of Object.keys(resolvedLinks[src])) {
        if (dest == name) {
          const linkText = path2linkText(src);
          if (forwardLinkSet.has(linkText)) {
            // ignore files, already listed in forward links.
            continue;
          }
          backLinkEntities.push(new FileEntity(src, linkText));
        }
      }
    }

    const statsPromises = backLinkEntities.map(async (entity) => {
      const stat = await this.app.vault.adapter.stat(entity.sourcePath);
      return { entity, stat };
    });

    const stats = (await Promise.all(statsPromises)).filter((it) => it);

    const sortFunction = this.getSortFunction(this.settings.sortOrder);
    stats.sort(sortFunction);

    return stats.map((it) => it!.entity);
  }

  private async readPreview(fileEntity: FileEntity) {
    if (
      fileEntity.linkText.match(/\.[a-z0-9_-]+$/i) &&
      !fileEntity.linkText.match(/\.(?:md|markdown|txt|text)$/i)
    ) {
      console.debug(`${fileEntity.linkText} is not a plain text file`);
      return "";
    }

    const linkText = removeBlockReference(fileEntity.linkText);
    console.debug(
      `readPreview: getFirstLinkpathDest: ${linkText}, fileEntity.linkText=${fileEntity.linkText}
      sourcePath=${fileEntity.sourcePath}`
    );

    const file = this.app.metadataCache.getFirstLinkpathDest(
      linkText,
      fileEntity.sourcePath
    );
    if (file == null) {
      return "";
    }
    if (file.stat.size > 1000 * 1000) {
      // Ignore large file
      console.debug(
        `File too large(${fileEntity.linkText}): ${file.stat.size}`
      );
      return "";
    }
    const content = await this.app.vault.read(file);

    const iframeMatch = content.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i);
    if (iframeMatch) {
      const iframeUrl = iframeMatch[1];
      const thumbnailUrl = this.getThumbnailUrlFromIframeUrl(iframeUrl);
      if (thumbnailUrl) {
        return thumbnailUrl;
      }
    }

    if (this.settings.showImage) {
      const m =
        content.match(
          /!\[(?:[^\]]*?)\]\(((?:https?:\/\/[^\)]+)|(?:[^\)]+.(?:png|bmp|jpg)))\)/
        ) || content.match(/!\[\[([^\]]+.(?:png|bmp|jpg))\]\]/);
      if (m) {
        const img = m[1];
        console.debug(`Found image: ${img}`);

        if (img.match(/^https?:\/\//)) {
          return img;
        } else {
          const file = this.app.metadataCache.getFirstLinkpathDest(
            img,
            fileEntity.sourcePath
          );
          console.debug(`Found image: ${img} = file=${file}`);
          if (file) {
            const resourcePath = this.app.vault.getResourcePath(file);
            console.debug(`Found image: ${img} resourcePath=${resourcePath}`);
            return resourcePath;
          }
        }
      }
    }

    const updatedContent = content.replace(/^(.*\n)?---[\s\S]*?---\n?/m, "");
    const lines = updatedContent.split(/\n/);
    return lines
      .filter((it) => {
        return (
          it.match(/\S/) &&
          !it.match(/^#/) &&
          !it.match(/^https?:\/\//)
        );
      })
      .slice(0, 6)
      .join("\n");
  }

  private getThumbnailUrlFromIframeUrl(iframeUrl: string): string | null {
    const youtubeIdMatch = iframeUrl.match(
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?&]+)(?:\?[^?]+)?$/
    );
    if (youtubeIdMatch) {
      const youtubeId = youtubeIdMatch[1];
      return `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
    }

    return null;
  }

  onunload(): void {
    this.disable(false);
    console.log("unloading plugin");
  }

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    return this.saveData(this.settings);
  }
}

class TwoHopLinksView extends ItemView {
  private plugin: TwohopLinksPlugin;
  private lastActiveLeaf: WorkspaceLeaf | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: TwohopLinksPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.containerEl.addClass("TwoHopLinks");
  }

  getViewType(): string {
    return "TwoHopLinksView";
  }

  getDisplayText(): string {
    return "2Hop Links";
  }

  async onOpen(): Promise<void> {
    try {
      this.lastActiveLeaf = this.app.workspace.getLeaf();
      await this.update();
      this.registerActiveFileUpdateEvent();
    } catch (error) {
      console.error('Error updating TwoHopLinksView', error);
    }
  }

  registerActiveFileUpdateEvent() {
    this.registerEvent(this.app.workspace.on('active-leaf-change', async (leaf: WorkspaceLeaf) => {
      if (leaf.view === this) {
        return;
      }
      this.lastActiveLeaf = leaf;
      await this.update();
    }));
  }

  async update(): Promise<void> {
    ReactDOM.render(<div>Loading...</div>, this.containerEl);
    try {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile == null) {
        ReactDOM.render(<div>No active file</div>, this.containerEl);
        return;
      }
      const twoHopLinksComponent = await this.plugin.renderTwohopLinksForView(activeFile);

      ReactDOM.render(twoHopLinksComponent, this.containerEl);

      this.addLinkEventListeners();
    } catch (error) {
      console.error('Error rendering two hop links', error);
      ReactDOM.render(<div>Error: Could not render two hop links</div>, this.containerEl);
    }
  }

  addLinkEventListeners(): void {
    const links = this.containerEl.querySelectorAll('a');
    links.forEach(link => {
      link.addEventListener('click', async (event) => {
        event.preventDefault();

        const filePath = link.getAttribute('href');
        if (!filePath) {
          console.error('Link does not have href attribute', link);
          return;
        }

        const fileOrFolder = this.app.vault.getAbstractFileByPath(filePath);
        if (!fileOrFolder || !(fileOrFolder instanceof TFile)) {
          console.error('No file found for path', filePath);
          return;
        }
        const file = fileOrFolder as TFile;

        if (!this.lastActiveLeaf) {
          console.error('No last active leaf');
          return;
        }

        await this.lastActiveLeaf.openFile(file);
      });
    });
  }

  async onload(): Promise<void> {
    this.addStyles();
  }

  addStyles() {
    const styleEl = this.app.workspace.containerEl.createEl('style');
    styleEl.textContent = `
    .TwoHopLinks {
      overflow: auto;
    }
  `;
  }
}
