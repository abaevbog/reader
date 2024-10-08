import Section from "epubjs/types/section";
import { getPotentiallyVisibleTextNodes, iterateWalker } from "../common/lib/nodes";
import {
	sanitizeAndRender,
	StyleScoper
} from "./lib/sanitize-and-render";
import { createSearchContext } from "../common/lib/find";

class SectionRenderer {
	readonly section: Section;

	readonly container: HTMLElement;

	readonly containerTemplate: HTMLTemplateElement;

	body!: HTMLElement;

	error = false;

	private readonly _window: Window & typeof globalThis;

	private readonly _document: Document;

	private readonly _sectionsContainer: HTMLElement;

	private readonly _styleScoper: StyleScoper;

	constructor(options: {
		section: Section,
		sectionsContainer: HTMLElement,
		window: Window & typeof globalThis,
		document: Document,
		styleScoper: StyleScoper,
	}) {
		this.section = options.section;
		this._sectionsContainer = options.sectionsContainer;
		this._window = options.window;
		this._document = options.document;
		this._styleScoper = options.styleScoper;

		let container = this._document.createElement('div');
		container.id = 'section-' + this.section.index;
		container.classList.add('section-container', 'cfi-stop');
		container.setAttribute('data-section-index', String(this.section.index));
		this.container = container;

		let containerTemplate = this._document.createElement('template');
		containerTemplate.setAttribute('data-section-index', String(this.section.index));
		this._sectionsContainer.append(containerTemplate);
		this.containerTemplate = containerTemplate;
	}

	unmount() {
		if (this.container.parentElement) {
			this.container.replaceWith(this.containerTemplate);
		}
	}

	mount() {
		if (this.containerTemplate.parentElement) {
			this.containerTemplate.replaceWith(this.container);
		}
	}

	get mounted() {
		return this.container.parentElement === this._sectionsContainer;
	}

	// eslint-disable-next-line @typescript-eslint/ban-types
	async render(requestFn: Function): Promise<void> {
		if (this.body) {
			throw new Error('Already rendered');
		}
		if (!this.section.url) {
			console.error('Section has no URL', this.section);
			this._displayError('Missing content');
			return;
		}
		let xhtml = await this.section.render(requestFn);

		try {
			this.body = await sanitizeAndRender(xhtml,
				{ container: this.container, styleScoper: this._styleScoper });
		}
		catch (e) {
			console.error('Error rendering section ' + this.section.index + ' (' + this.section.href + ')', e);
			this._displayError('Invalid content');
		}
	}

	private _displayError(message: string) {
		let errorDiv = this._document.createElement('div');
		errorDiv.style.color = 'red';
		errorDiv.style.fontSize = '1.5em';
		errorDiv.style.fontWeight = 'bold';
		errorDiv.style.textAlign = 'center';
		errorDiv.append(`[Section ${this.section.index}: ${message}]`);
		this.container.replaceChildren(errorDiv);
		this.body = errorDiv;
		this.error = true;
	}

	/**
	 * Return a range before or at the top of the viewport.
	 *
	 * @param isHorizontal Whether the viewport is laid out horizontally (paginated mode)
	 * @param textNodesOnly Return only text nodes, for constructing CFIs
	 */
	getFirstVisibleRange(isHorizontal: boolean, textNodesOnly: boolean): Range | null {
		if (!this.mounted) {
			return null;
		}
		let viewportEnd = isHorizontal ? this._window.frameElement!.clientWidth : this._window.frameElement!.clientHeight;
		let filter = NodeFilter.SHOW_TEXT | (textNodesOnly ? 0 : NodeFilter.SHOW_ELEMENT);
		let iter = this._document.createNodeIterator(this.container, filter, (node) => {
			return node.nodeType == Node.TEXT_NODE && node.nodeValue?.trim().length
					|| (node as Element).tagName === 'IMG'
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_SKIP;
		});
		let bestRange = null;
		for (let node of iterateWalker(iter)) {
			let range = this._document.createRange();
			if (node.nodeType == Node.ELEMENT_NODE) {
				range.selectNode(node);
			}
			else {
				range.selectNodeContents(node);
			}

			let rect = range.getBoundingClientRect();
			// Skip invisible nodes
			if (!(rect.width || rect.height)) {
				continue;
			}
			let rectStart = isHorizontal ? rect.left : rect.top;
			let rectEnd = isHorizontal ? rect.right : rect.bottom;
			// If the range starts past the end of the viewport, we've gone too far -- return our previous best guess
			if (rectStart > viewportEnd) {
				return bestRange;
			}
			// If it starts in the viewport, return it immediately
			if (rectStart >= 0 || (rectStart < 0 && rectEnd > 0)) {
				return range;
			}
			// Otherwise, it's above the start of the viewport -- save it as our best guess in case nothing within
			// the viewport is usable, but keep going
			else {
				bestRange = range;
			}
		}
		return null;
	}

	get searchContext() {
		let searchContext = createSearchContext(getPotentiallyVisibleTextNodes(this.container));
		Object.defineProperty(this, 'searchContext', { value: searchContext });
		return searchContext;
	}
}

export default SectionRenderer;
