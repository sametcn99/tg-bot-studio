/** Client-facing media asset row. */
export interface MediaAssetRow {
  id: string;
  botId: string;
  name: string;
  source: string;
  value: string;
  kind: string;
  mimeType: string | null;
  fileSize: number | null;
  tags: string | null;
  createdAt: string | null;
}
