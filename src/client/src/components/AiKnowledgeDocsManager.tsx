import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SendIcon from '@mui/icons-material/Send';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';

interface KnowledgeDoc {
  id: number;
  title: string;
  content: string;
  tags: string | null;
  created_at: string;
}

export default function AiKnowledgeDocsManager({ botId }: { botId: number }): React.ReactElement {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');

  // Interactive RAG test state
  const [testQuestion, setTestQuestion] = useState('');
  const [testAnswer, setTestAnswer] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocs = () => {
    setLoading(true);
    apiFetch<KnowledgeDoc[]>(`/api/bots/${botId}/ai-assistant/docs`)
      .then(setDocs)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDocs();
  }, [botId]);

  const handleCreateDoc = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      await apiFetch(`/api/bots/${botId}/ai-assistant/docs`, {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim(), content: newContent.trim(), tags: newTags.trim() }),
      });
      setDialogOpen(false);
      setNewTitle('');
      setNewContent('');
      setNewTags('');
      loadDocs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteDoc = async (docId: number) => {
    try {
      await apiFetch(`/api/bots/${botId}/ai-assistant/docs/${docId}`, {
        method: 'DELETE',
      });
      loadDocs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async () => {
    if (!testQuestion.trim() || testLoading) return;
    setTestLoading(true);
    setTestAnswer(null);
    setError(null);
    try {
      const res = await apiFetch<{ reply: string }>(`/api/bots/${botId}/ai-assistant/test`, {
        method: 'POST',
        body: JSON.stringify({ message: testQuestion.trim() }),
      });
      setTestAnswer(res.reply);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Stack spacing={2.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1} alignItems="center">
              <MenuBookIcon color="primary" />
              <Box>
                <Typography variant="subtitle1" fontWeight={700}>
                  RAG Knowledge Base & FAQs
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Uploaded documents and FAQs are automatically searched to ground AI responses with enterprise truth.
                </Typography>
              </Box>
            </Stack>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
            >
              Add Document / FAQ
            </Button>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}

          {loading ? (
            <Box sx={{ py: 2, textAlign: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Stack spacing={1.5}>
              {docs.map((doc) => (
                <Paper key={doc.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {doc.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                        {doc.content.length > 200 ? `${doc.content.slice(0, 200)}...` : doc.content}
                      </Typography>
                      {doc.tags && (
                        <Typography variant="caption" color="primary" sx={{ mt: 1, display: 'block' }}>
                          Tags: {doc.tags}
                        </Typography>
                      )}
                    </Box>
                    <Tooltip title={t('actions.delete')}>
                      <IconButton size="small" color="error" onClick={() => void handleDeleteDoc(doc.id)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              ))}

              {docs.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                  No knowledge base documents added yet. Add company policies, pricing sheets, or FAQs to power RAG.
                </Typography>
              )}
            </Stack>
          )}

          <Divider sx={{ my: 1 }} />

          {/* Interactive RAG Tester */}
          <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <AutoAwesomeIcon color="secondary" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={600}>
                Interactive RAG & Tool Tester
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField
                size="small"
                fullWidth
                placeholder="Ask a question to test knowledge retrieval (e.g. What is your refund policy?)..."
                value={testQuestion}
                onChange={(e) => setTestQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleTest();
                }}
              />
              <Button
                variant="contained"
                onClick={handleTest}
                disabled={!testQuestion.trim() || testLoading}
                startIcon={testLoading ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
              >
                Test
              </Button>
            </Stack>

            {testAnswer && (
              <Box sx={{ mt: 2, p: 2, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>
                  AI Assistant Output:
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {testAnswer}
                </Typography>
              </Box>
            )}
          </Box>
        </Stack>
      </CardContent>

      {/* Add Document Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Knowledge Base Document / FAQ</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Document / Topic Title"
              size="small"
              fullWidth
              placeholder="e.g. Return & Refund Policy"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <TextField
              label="Content or FAQ Answer"
              size="small"
              fullWidth
              multiline
              minRows={6}
              placeholder="Paste full text, guidelines, or frequently asked questions here..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
            />
            <TextField
              label="Tags (optional, comma-separated)"
              size="small"
              fullWidth
              placeholder="refund, return, policy"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateDoc} disabled={!newTitle.trim() || !newContent.trim()}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
