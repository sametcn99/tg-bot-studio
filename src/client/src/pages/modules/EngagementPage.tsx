import React, { useEffect, useState } from 'react';
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
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import ModuleConfigPage from '../ModuleConfigPage';
import { findModule, type ModuleEntry } from '../../registry/modules';

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
  const [tab, setTab] = useState(0);
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [form, setForm] = useState({ question: '', options: '', correctOptionId: 0, points: 1 });

  const reactionsModule = findModule('reactions');
  const totalReactions = Object.values(reactions).reduce((sum, count) => sum + count, 0);

  useEffect(() => {
    reload();
  }, [botId]);

  /**
   * Reloads quizzes and the reaction summary.
   * @returns {void}
   */
  function reload(): void {
    apiFetch<QuizRow[]>(`/api/bots/${botId}/engagement/quizzes`).then(setQuizzes).catch(() => undefined);
    apiFetch<Record<string, number>>(`/api/bots/${botId}/engagement/reactions/summary`)
      .then(setReactions)
      .catch(() => undefined);
  }

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
        reload();
      })
      .catch((err: Error) => setError(err.message));
  }

  return (
    <Box>
      <PageHeader
        title="Engagement"
        subtitle="Interactive quizzes, polls, and reaction analytics"
        onDocs={() => setDocsOpen(true)}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Tabs
        value={tab}
        onChange={(_event, value: number) => setTab(value)}
        sx={{ mb: 2 }}
        aria-label="Engagement sections"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        <Tab label="Quizzes & Polls" />
        <Tab label="Reaction Analytics" />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ maxWidth: 520 }}>
                <TextField
                  label="Question"
                  size="small"
                  value={form.question}
                  onChange={(event) => setForm({ ...form, question: event.target.value })}
                />
                <TextField
                  label="Options (one per line)"
                  size="small"
                  multiline
                  minRows={3}
                  value={form.options}
                  onChange={(event) => setForm({ ...form, options: event.target.value })}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Correct option (0-based)"
                    type="number"
                    size="small"
                    value={form.correctOptionId}
                    onChange={(event) => setForm({ ...form, correctOptionId: Number(event.target.value) })}
                  />
                  <TextField
                    label="Points"
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
            <Table size="small" aria-label="Quiz records">
              <TableHead>
                <TableRow>
                  <TableCell>Question</TableCell>
                  <TableCell>Options</TableCell>
                  <TableCell align="right">Points</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {quizzes.map((quiz) => (
                  <TableRow key={quiz.id}>
                    <TableCell>{quiz.question}</TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {quiz.options.join(' / ')}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{quiz.points}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          void apiFetch(`/api/bots/${botId}/engagement/quizzes/${quiz.id}`, {
                            method: 'DELETE',
                          }).then(reload);
                        }}
                      >
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
                Quiz trigger configuration
              </Typography>
              <ModuleConfigPage botId={botId} module={module} />
            </CardContent>
          </Card>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1 }} component="h3">
                Reaction summary
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {totalReactions}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                total tracked reactions
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
                  Reaction points configuration
                </Typography>
                <ModuleConfigPage botId={botId} module={reactionsModule} />
              </CardContent>
            </Card>
          )}
        </Stack>
      )}

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
