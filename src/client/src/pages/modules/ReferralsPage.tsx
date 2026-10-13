import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Stack,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import ModuleConfigPage from '../ModuleConfigPage';
import type { ModuleEntry } from '../../registry/modules';

/**
 * Leaderboard row derived from the audience list.
 * @interface LeaderRow
 * @property {number} telegram_id - Subscriber Telegram id.
 * @property {string} [username] - Telegram @username.
 * @property {string} [first_name] - First name.
 * @property {number} points - Point balance.
 */
interface LeaderRow {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  points: number;
}

/**
 * Referral leaderboard page: configuration card plus the top point holders.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Referrals catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function ReferralsPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);

  useEffect(() => {
    apiFetch<LeaderRow[]>(`/api/bots/${botId}/users`)
      .then((users) =>
        setLeaders(
          [...users]
            .filter((user) => user.points > 0)
            .sort((a, b) => b.points - a.points)
            .slice(0, 20),
        ),
      )
      .catch(() => undefined);
  }, [botId]);

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
      />

      <Stack spacing={3}>
        <ModuleConfigPage botId={botId} module={module} embedded={true} />

        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }} component="h3">
              Leaderboard
            </Typography>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="Referral leaderboard">
                <TableHead>
                  <TableRow>
                    <TableCell>Rank</TableCell>
                    <TableCell>Member</TableCell>
                    <TableCell align="right">Points</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {leaders.map((leader, index) => (
                    <TableRow key={leader.telegram_id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        {leader.username
                          ? `@${leader.username}`
                          : (leader.first_name ?? String(leader.telegram_id))}
                      </TableCell>
                      <TableCell align="right">{leader.points}</TableCell>
                    </TableRow>
                  ))}
                  {leaders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                          {t('common.empty')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Stack>

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
