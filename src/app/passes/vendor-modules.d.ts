/**
 * Minimal typings for the lazily imported vendor entry points whose subpath
 * exports the app's `moduleResolution: node` cannot see. Only the parts the
 * passes code uses. zxing-wasm ships typesVersions and needs nothing here.
 */
declare module 'bwip-js/browser' {
  export interface BwipRenderOptions {
    bcid: string;
    text: string;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    height?: number;
    paddingwidth?: number;
    paddingheight?: number;
    backgroundcolor?: string;
    barcolor?: string;
    columns?: number;
    [key: string]: unknown;
  }
  export function toSVG(opts: BwipRenderOptions): string;
}

declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export interface PdfViewport { width: number; height: number }
  export interface PdfPage {
    getViewport(o: { scale: number }): PdfViewport;
    render(o: { canvasContext: unknown; canvas: unknown; viewport: PdfViewport }): { promise: Promise<void> };
    cleanup(): void;
  }
  export interface PdfDocument { numPages: number; getPage(n: number): Promise<PdfPage> }
  export interface PdfLoadingTask { promise: Promise<PdfDocument>; destroy(): Promise<void> }
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(src: { data: Uint8Array | ArrayBuffer; isEvalSupported?: boolean; disableFontFace?: boolean }): PdfLoadingTask;
}
