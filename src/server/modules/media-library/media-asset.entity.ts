/** Client-facing media asset row. */
export interface MediaAssetRow {
  id: number;
  botId: number;
  name: string;
  source: string;
  value: string;
  kind: string;
  mimeType: string | null;
  fileSize: number | null;
  tags: string | null;
  createdAt: string | null;
}
