import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Tab,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useSnackbar } from '../../context/SnackbarContext';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import ModuleConfigPage from '../ModuleConfigPage';
import { useLocalizedModule } from '../../registry/localize';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';

/**
 * Quiz definition row.
 * @interface QuizRow
 * @property {string} id - Quiz id.
 * @property {string} question - Quiz question.
 * @property {string[]} options - Answer options.
 * @property {number} correctOptionId - Correct option index.
 * @property {number} points - Points per correct answer.
 */
interface QuizRow {
  id: string;
  question: string;
  options: string[];
  correctOptionId: number;
  points: number;
}

/**
 * Engagement page: quizzes CRUD, reaction analytics summary, and the two
 * module configuration cards (quizzes + reactions).
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Quizzes catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function EngagementPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [tab, setTab] = useState(0);
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const { openDocs } = useModuleDocs();
  const [form, setForm] = useState({ question: '', options: '', correctOptionId: 0, points: 1 });
  const [quizToDelete, setQuizToDelete] = useState<QuizRow | null>(null);

  const reactionsModule = useLocalizedModule('reactions');
  const totalReactions = Object.values(reactions).reduce((sum, count) => sum + count, 0);

  const reload = useCallback((): void => {
    apiFetch<QuizRow[]>(`/api/bots/${botId}/engagement/quizzes`)
      .then(setQuizzes)
      .catch(() => undefined);
    apiFetch<Record<string, number>>(`/api/bots/${botId}/engagement/reactions/summary`)
      .then(setReactions)
      .catch(() => undefined);
  }, [botId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * Creates a quiz from the form state.
   * @returns {void}
   */
  function createQuiz(): void {
    const options = form.options
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean);
    apiFetch(`/api/bots/${botId}/engagement/quizzes`, {
      method: 'POST',
      body: JSON.stringify({
        question: form.question,
        options,
        correctOptionId: Number(form.correctOptionId),
        points: Number(form.points),
      }),
    })
      .then(() => {
        setForm({ question: '', options: '', correctOptionId: 0, points: 1 });
        showSuccess(t('engagement.quizCreated'));
        reload();
      })
      .catch((err: Error) => {
        setError(localizedErrorMessage(err));
        showError(localizedErrorMessage(err));
      });
  }

  /**
   * Confirms and deletes a quiz.
   * @returns {void}
   */
  function handleDeleteQuiz(): void {
    if (!quizToDelete) return;
    const target = quizToDelete;
    apiFetch(`/api/bots/${botId}/engagement/quizzes/${target.id}`, {
      method: 'DELETE',
    })
      .then(() => {
        showSuccess(t('common.deleted'));
        setQuizToDelete(null);
        reload();
      })
      .catch((err: Error) => {
        showError(localizedErrorMessage(err));
      });
  }

  return (
    <Box>
      <PageHeader
        title={t('engagement.title')}
        subtitle={t('engagement.subtitle')}
        onDocs={() => openDocs(module)}
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_event, value: number) => setTab(value)}
        sx={{ mb: 2 }}
        aria-label={t('engagement.sectionsAria')}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        <Tab label={t('engagement.tabQuizzes')} />
        <Tab label={t('engagement.tabReactions')} />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ maxWidth: 520 }}>
                <TextField
                  label={t('engagement.question')}
                  size="small"
                  value={form.question}
                  onChange={(event) => setForm({ ...form, question: event.target.value })}
                />
                <TextField
                  label={t('engagement.optionsLabel')}
                  size="small"
                  multiline
                  minRows={3}
                  value={form.options}
                  onChange={(event) => setForm({ ...form, options: event.target.value })}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    label={t('engagement.correctOption')}
                    type="number"
                    size="small"
                    value={form.correctOptionId}
                    onChange={(event) =>
                      setForm({ ...form, correctOptionId: Number(event.target.value) })
                    }
                  />
                  <TextField
                    label={t('engagement.points')}
                    type="number"
                    size="small"
                    value={form.points}
                    onChange={(event) => setForm({ ...form, points: Number(event.target.value) })}
                  />
                </Stack>
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    disabled={!form.question || !form.options}
                    onClick={createQuiz}
                  >
                    {t('actions.create')}
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('engagement.quizRecordsAria')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('engagement.question')}</TableCell>
                    <TableCell>{t('engagement.options')}</TableCell>
                    <TableCell align="right">{t('engagement.points')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {quizzes.map((quiz) => (
                    <TableRow key={quiz.id}>
                      <TableCell>{quiz.question}</TableCell>
                      <TableCell>
                        <Typography variant="caption">{quiz.options.join(' / ')}</Typography>
                      </TableCell>
                      <TableCell align="right">{quiz.points}</TableCell>
                      <TableCell align="right">
                        <Button size="small" color="error" onClick={() => setQuizToDelete(quiz)}>
                          {t('actions.delete')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {quizzes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                          {t('common.empty')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 2 }} component="h3">
                {t('engagement.quizTriggerConfig')}
              </Typography>
              <ModuleConfigPage botId={botId} module={module} embedded={true} />
            </CardContent>
          </Card>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1 }} component="h3">
                {t('engagement.reactionSummary')}
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {totalReactions}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('engagement.totalReactions')}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
                {Object.entries(reactions).map(([emoji, count]) => (
                  <Typography key={emoji} variant="body2">
                    {emoji} x {count}
                  </Typography>
                ))}
                {totalReactions === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {t('common.empty')}
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
          {reactionsModule && (
            <Card>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2 }} component="h3">
                  {t('engagement.reactionPointsConfig')}
                </Typography>
                <ModuleConfigPage botId={botId} module={reactionsModule} embedded={true} />
              </CardContent>
            </Card>
          )}
        </Stack>
      )}

      <ConfirmDialog
        open={Boolean(quizToDelete)}
        title={t('actions.delete')}
        message={t('engagement.deleteQuizConfirm', { question: quizToDelete?.question ?? '' })}
        onConfirm={handleDeleteQuiz}
        onCancel={() => setQuizToDelete(null)}
      />
    </Box>
  );
}
