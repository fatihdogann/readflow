declare module "@mozilla/readability" {
  export interface ReadabilityArticle {
    title: string;
    content: string;
    textContent: string;
    length: number;
    excerpt: string;
    byline: string | null;
    dir: string | null;
    siteName: string | null;
    lang: string | null;
    publishedTime: string | null;
  }

  export class Readability {
    constructor(doc: Document, options?: Record<string, unknown>);
    parse(): ReadabilityArticle | null;
  }

  export class JSDOMParser {
    constructor();
    parse(html: string): Document;
  }
}
