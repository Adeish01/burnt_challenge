declare module "pdf-parse" {
  export type PdfParseResult = {
    text: string;
  };

  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;

  export default pdfParse;
}
