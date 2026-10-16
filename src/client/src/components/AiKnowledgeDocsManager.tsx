import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SendIcon from '@mui/icons-material/Send';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
import SourceIcon from '@mui/icons-material/Source';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import ConfirmDialog from './ConfirmDialog';
import AiGenerateButton from './AiGenerateButton';
import { useSnackbar } from '../context/SnackbarContext';
import { localizedErrorMessage } from '../utils/errors';

interface KnowledgeDoc {
  id: number;
  title: string;
  content: string;
  tags: string | null;
  created_at: string;
}

/** Matched knowledge chunk returned by the tester for citations. */
interface TestSource {
  docId: number;
  docTitle: string;
  content: string;
  score: number;
}

/** Aggregate AI usage metrics from the metrics endpoint. */
interface AiMetrics {
  requests: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
}

export default function AiKnowledgeDocsManager({ botId }: { botId: number }): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDocId, setEditingDocId] = useState<number | null>(null);
  const [docToView, setDocToView] = useState<KnowledgeDoc | null>(null);
  const [docToDelete, setDocToDelete] = useState<KnowledgeDoc | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');

  // Interactive RAG test state
  const [testQuestion, setTestQuestion] = useState('');
  const [testAnswer, setTestAnswer] = useState<string | null>(null);
  const [testSources, setTestSources] = useState<TestSource[]>([]);
  const [testLoading, setTestLoading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [metrics, setMetrics] = useState<AiMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDocs = useCallback(() => {
    setLoading(true);
    apiFetch<KnowledgeDoc[]>(`/api/bots/${botId}/ai-assistant/docs`)
      .then(setDocs)
      .catch((err: Error) => setError(localizedErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [botId]);

  const loadMetrics = useCallback(() => {
    apiFetch<AiMetrics>(`/api/bots/${botId}/ai-assistant/metrics?days=7`)
      .then(setMetrics)
      .catch(() => undefined);
  }, [botId]);

  useEffect(() => {
    loadDocs();
    loadMetrics();
  }, [loadDocs, loadMetrics]);

  const openCreateDialog = () => {
    setEditingDocId(null);
    setNewTitle('');
    setNewContent('');
    setNewTags('');
    setDialogOpen(true);
  };

  const openEditDialog = (doc: KnowledgeDoc) => {
    setEditingDocId(doc.id);
    setNewTitle(doc.title);
    setNewContent(doc.content);
    setNewTags(doc.tags ?? '');
    setDialogOpen(true);
  };

  const handleSaveDoc = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      if (editingDocId) {
        await apiFetch(`/api/bots/${botId}/ai-assistant/docs/${editingDocId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: newTitle.trim(),
            content: newContent.trim(),
            tags: newTags.trim(),
          }),
        });
        showSuccess(t('aiDocs.updated'));
      } else {
        await apiFetch(`/api/bots/${botId}/ai-assistant/docs`, {
          method: 'POST',
          body: JSON.stringify({
            title: newTitle.trim(),
            content: newContent.trim(),
            tags: newTags.trim(),
          }),
        });
        showSuccess(t('aiDocs.added'));
      }
      setDialogOpen(false);
      setEditingDocId(null);
      setNewTitle('');
      setNewContent('');
      setNewTags('');
      loadDocs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      showError(msg);
    }
  };

  const handleDeleteDoc = async () => {
    if (!docToDelete) return;
    const target = docToDelete;
    try {
      await apiFetch(`/api/bots/${botId}/ai-assistant/docs/${target.id}`, {
        method: 'DELETE',
      });
      showSuccess(t('aiDocs.deleted'));
      setDocToDelete(null);
      loadDocs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      showError(msg);
    }
  };

  const handleTest = async () => {
    if (!testQuestion.trim() || testLoading) return;
    setTestLoading(true);
    setTestAnswer(null);
    setTestSources([]);
    setError(null);
    try {
      const res = await apiFetch<{ reply: string; sources: TestSource[] }>(
        `/api/bots/${botId}/ai-assistant/test`,
        {
          method: 'POST',
          body: JSON.stringify({ message: testQuestion.trim() }),
        },
      );
      setTestAnswer(res.reply);
      setTestSources(res.sources ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      showError(msg);
    } finally {
      setTestLoading(false);
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const res = await apiFetch<{ chunks: number }>(
        `/api/bots/${botId}/ai-assistant/docs/reindex`,
        { method: 'POST' },
      );
      showSuccess(t('aiDocs.reindexed', { count: res.chunks }));
      loadDocs();
    } catch (err: unknown) {
      showError(localizedErrorMessage(err));
    } finally {
      setReindexing(false);
    }
  };

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Stack spacing={2.5}>
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'center',
              }}
            >
              <MenuBookIcon color="primary" />
              <Box>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700,
                  }}
                >
                  {t('aiDocs.title')}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {t('aiDocs.subtitle')}
                </Typography>
              </Box>
            </Stack>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={openCreateDialog}
            >
              {t('aiDocs.addDocument')}
            </Button>
          </Stack>

          {metrics && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Chip size="small" label={t('aiDocs.metricRequests', { count: metrics.requests })} />
              <Chip
                size="small"
                color={metrics.errors > 0 ? 'error' : 'default'}
                label={t('aiDocs.metricErrors', { count: metrics.errors })}
              />
              <Chip
                size="small"
                label={t('aiDocs.metricTokens', {
                  count: metrics.promptTokens + metrics.completionTokens,
                })}
              />
              <Chip
                size="small"
                label={t('aiDocs.metricLatency', { count: metrics.avgLatencyMs })}
              />
            </Stack>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          {loading ? (
            <Box sx={{ py: 2, textAlign: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Stack spacing={1.5}>
              {docs.map((doc) => (
                <Paper key={doc.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="subtitle2"
                        onClick={() => setDocToView(doc)}
                        sx={{
                          fontWeight: 700,
                          cursor: 'pointer',
                          '&:hover': { color: 'primary.main' },
                        }}
                      >
                        {doc.title}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'text.secondary',
                          mt: 0.5,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {doc.content.length > 200 ? `${doc.content.slice(0, 200)}...` : doc.content}
                      </Typography>
                      {doc.tags && (
                        <Typography
                          variant="caption"
                          color="primary"
                          sx={{ mt: 1, display: 'block' }}
                        >
                          {t('aiDocs.tags', { tags: doc.tags })}
                        </Typography>
                      )}
                    </Box>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{
                        alignItems: 'center',
                      }}
                    >
                      <Tooltip title={t('aiDocs.viewFull')}>
                        <IconButton size="small" onClick={() => setDocToView(doc)}>
                          <VisibilityOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('actions.edit')}>
                        <IconButton size="small" onClick={() => openEditDialog(doc)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('actions.delete')}>
                        <IconButton size="small" color="error" onClick={() => setDocToDelete(doc)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </Paper>
              ))}

              {docs.length === 0 && (
                <Stack spacing={1.5} sx={{ py: 2, alignItems: 'center' }}>
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'text.secondary',
                      textAlign: 'center',
                    }}
                  >
                    {t('aiDocs.empty')}
                  </Typography>
                  <AiGenerateButton
                    botId={botId}
                    kind="knowledge-faq"
                    onResult={(text) => {
                      const titleMatch = text.match(/^#\s+(.+)$/m);
                      const title = (titleMatch?.[1] ?? 'AI FAQ Draft').trim();
                      const body = titleMatch ? text.replace(titleMatch[0], '').trim() : text;
                      void apiFetch(`/api/bots/${botId}/ai-assistant/docs`, {
                        method: 'POST',
                        body: JSON.stringify({ title, content: body, tags: 'faq' }),
                      })
                        .then(() => {
                          showSuccess(t('aiDocs.added'));
                          loadDocs();
                        })
                        .catch((err: unknown) => showError(localizedErrorMessage(err)));
                    }}
                  />
                </Stack>
              )}
            </Stack>
          )}

          <Divider sx={{ my: 1 }} />

          {/* Interactive RAG Tester */}
          <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'center',
                mb: 1.5,
              }}
            >
              <AutoAwesomeIcon color="secondary" fontSize="small" />
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 600,
                }}
              >
                {t('aiDocs.testerTitle')}
              </Typography>
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'center',
              }}
            >
              <TextField
                size="small"
                fullWidth
                placeholder={t('aiDocs.testPlaceholder')}
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
                startIcon={
                  testLoading ? <CircularProgress size={16} color="inherit" /> : <SendIcon />
                }
              >
                {t('aiDocs.test')}
              </Button>
              <Tooltip title={t('aiDocs.reindex')}>
                <span>
                  <Button
                    variant="outlined"
                    onClick={() => void handleReindex()}
                    disabled={reindexing}
                    startIcon={
                      reindexing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />
                    }
                  >
                    {t('aiDocs.reindex')}
                  </Button>
                </span>
              </Tooltip>
            </Stack>

            {testAnswer && (
              <Box
                sx={{
                  mt: 2,
                  p: 2,
                  borderRadius: 1.5,
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    fontWeight: 700,
                  }}
                >
                  {t('aiDocs.testOutput')}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {testAnswer}
                </Typography>
                {testSources.length > 0 && (
                  <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        fontWeight: 700,
                      }}
                    >
                      {t('aiDocs.sources')}
                    </Typography>
                    {testSources.map((source) => (
                      <Stack
                        key={`${source.docId}-${source.score}`}
                        direction="row"
                        spacing={0.5}
                        sx={{
                          alignItems: 'center',
                        }}
                      >
                        <SourceIcon fontSize="small" color="primary" />
                        <Typography
                          variant="caption"
                          sx={{
                            color: 'text.secondary',
                          }}
                        >
                          {source.docTitle}
                          {source.score > 0 ? ` · ${source.score}` : ''}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            )}
          </Box>
        </Stack>
      </CardContent>

      {/* Add / Edit Document Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingDocId ? t('aiDocs.editTitle') : t('aiDocs.addTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('aiDocs.titleLabel')}
              size="small"
              fullWidth
              placeholder={t('aiDocs.titlePlaceholder')}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <TextField
              label={t('aiDocs.contentLabel')}
              size="small"
              fullWidth
              multiline
              minRows={6}
              placeholder={t('aiDocs.contentPlaceholder')}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
            />
            <TextField
              label={t('aiDocs.tagsLabel')}
              size="small"
              fullWidth
              placeholder={t('aiDocs.tagsPlaceholder')}
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('actions.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSaveDoc}
            disabled={!newTitle.trim() || !newContent.trim()}
          >
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Full Document Dialog */}
      <Dialog open={Boolean(docToView)} onClose={() => setDocToView(null)} maxWidth="md" fullWidth>
        <DialogTitle>{docToView?.title}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {docToView?.tags && (
              <Typography
                variant="caption"
                color="primary"
                sx={{
                  fontWeight: 600,
                }}
              >
                {t('aiDocs.tags', { tags: docToView.tags })}
              </Typography>
            )}
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {docToView?.content}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDocToView(null)}>{t('actions.close')}</Button>
          <Button
            variant="outlined"
            onClick={() => {
              if (docToView) {
                const doc = docToView;
                setDocToView(null);
                openEditDialog(doc);
              }
            }}
          >
            {t('actions.edit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={Boolean(docToDelete)}
        title={t('aiDocs.deleteTitle')}
        message={t('aiDocs.deleteConfirm', { title: docToDelete?.title ?? '' })}
        onConfirm={handleDeleteDoc}
        onCancel={() => setDocToDelete(null)}
      />
    </Card>
  );
}
