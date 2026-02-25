declare module "html-to-text" {
  export type HtmlToTextOptions = {
    wordwrap?: false | number;
    selectors?: Array<{ selector: string; format: string }>;
  };

  export function convert(html: string, options?: HtmlToTextOptions): string;
}
