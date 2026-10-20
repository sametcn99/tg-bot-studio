import React, { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  Fab,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useBots } from '../context/BotContext';
import { onSimulatorRequest } from '../utils/simulatorBus';
import { markSimulatorUsed } from './OnboardingChecklist';

interface SimMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  mediaUrl?: string | null;
  buttons?: Array<{ text: string; url?: string; callback_data?: string }>;
  time: string;
}

export default function BotSimulatorDrawer(): React.ReactElement {
  const { t } = useTranslation();
  const { activeBot } = useBots();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SimMessage[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: t('simulator.welcome'),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  /** Simulated surface: private chat or the sandbox supergroup. */
  const [surface, setSurface] = useState<'private' | 'supergroup'>('private');
  const [loading, setLoading] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the conversation to the newest bubble.
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Module pages can ask the simulator to test a rule ("test in simulator").
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => {});
  useEffect(
    () =>
      onSimulatorRequest((text) => {
        setOpen(true);
        // Wait for the drawer to open and the bot context to be ready.
        window.setTimeout(() => void sendRef.current(text), 250);
      }),
    [],
  );

  const sendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text || !activeBot || loading) return;

    const userMsg: SimMessage = {
      id: `u_${Date.now()}`,
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await apiFetch<{
        text: string;
        mediaUrl?: string | null;
        buttons?: Array<{ text: string; url?: string; callback_data?: string }>;
      }>(`/api/bots/${activeBot.id}/simulator/send`, {
        method: 'POST',
        body: JSON.stringify({ message: text, chatType: surface }),
      });

      const botMsg: SimMessage = {
        id: `b_${Date.now()}`,
        sender: 'bot',
        text: res.text,
        mediaUrl: res.mediaUrl,
        buttons: res.buttons,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, botMsg]);
      markSimulatorUsed();
    } catch (err: unknown) {
      const errorMsg: SimMessage = {
        id: `err_${Date.now()}`,
        sender: 'bot',
        text: t('simulator.error', {
          message: err instanceof Error ? err.message : String(err),
        }),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Simulates a synthetic group event (join / leave / chat_member) through
   * the real module chain against the sandbox supergroup.
   * @param {'join'|'leave'|'chat_member'} event - Sandbox event type.
   * @returns {Promise<void>} Resolves after the sandbox reply lands.
   */
  const sendEvent = async (event: 'join' | 'leave' | 'chat_member'): Promise<void> => {
    if (!activeBot || loading) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ text: string }>(`/api/bots/${activeBot.id}/simulator/send`, {
        method: 'POST',
        body: JSON.stringify({ message: '', chatType: 'supergroup', event }),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          sender: 'bot',
          text: res.text,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch {
      // Sandbox event failures are non-fatal in the drawer.
    } finally {
      setLoading(false);
    }
  };

  /**
   * Presses an inline button: callback buttons go through the callback
   * simulation endpoint; URL buttons open externally; legacy text fallback
   * re-sends the label as a message.
   * @param {{ text: string; url?: string; callback_data?: string }} btn - Button.
   * @returns {Promise<void>} Resolves after the sandbox reply lands.
   */
  const pressButton = async (btn: {
    text: string;
    url?: string;
    callback_data?: string;
  }): Promise<void> => {
    if (!activeBot || loading) return;
    if (btn.callback_data) {
      setLoading(true);
      setMessages((prev) => [
        ...prev,
        {
          id: `cb_${Date.now()}`,
          sender: 'user',
          text: `🔘 ${btn.text}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      try {
        const res = await apiFetch<{
          text: string;
          mediaUrl?: string | null;
          buttons?: Array<{ text: string; url?: string; callback_data?: string }>;
        }>(`/api/bots/${activeBot.id}/simulator/callback`, {
          method: 'POST',
          body: JSON.stringify({ callbackData: btn.callback_data, chatType: surface }),
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `b_${Date.now()}`,
            sender: 'bot',
            text: res.text,
            mediaUrl: res.mediaUrl,
            buttons: res.buttons,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      } catch (err: unknown) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            sender: 'bot',
            text: t('simulator.error', {
              message: err instanceof Error ? err.message : String(err),
            }),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (btn.url?.startsWith('http')) {
      window.open(btn.url, '_blank');
      return;
    }
    void sendMessage(btn.text);
  };
  sendRef.current = sendMessage;

  const handleClear = () => {
    setMessages([]);
  };

  if (!activeBot) return <React.Fragment />;

  return (
    <>
      {/* Floating Launch Button */}
      <Fab
        color="primary"
        variant="extended"
        size="medium"
        onClick={() => setOpen(true)}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1200,
          boxShadow: 4,
          fontWeight: 700,
          textTransform: 'none',
          gap: 1,
        }}
      >
        <SmartToyIcon />
        {t('simulator.title')}
      </Fab>

      {/* Simulator Side Drawer */}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: { xs: '100%', sm: 400 },
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.default',
            },
          },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 2,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: 'center',
              }}
            >
              <Avatar sx={{ bgcolor: 'primary.main', width: 36, height: 36 }}>
                <SmartToyIcon fontSize="small" />
              </Avatar>
              <Box>
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                  }}
                >
                  {activeBot.name}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'success.main',
                    fontWeight: 600,
                  }}
                >
                  ● {t('simulator.sandboxActive')}
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.5}>
              <Tooltip title={t('simulator.clear')}>
                <IconButton size="small" onClick={handleClear}>
                  <DeleteSweepIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton size="small" onClick={() => setOpen(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>

          {/* Quick command pills */}
          <Stack direction="row" spacing={0.5} sx={{ mt: 1.5, overflowX: 'auto', pb: 0.5 }}>
            <Chip size="small" label="/start" onClick={() => void sendMessage('/start')} />
            <Chip size="small" label="/menu" onClick={() => void sendMessage('/menu')} />
            <Chip
              size="small"
              label={t('simulator.quickHelp')}
              onClick={() => void sendMessage('help')}
            />
            <Chip
              size="small"
              label={t('simulator.quickPricing')}
              onClick={() => void sendMessage('pricing')}
            />
            {surface === 'supergroup' && (
              <Chip
                size="small"
                icon={<PersonAddAlt1Icon sx={{ fontSize: 14 }} />}
                label={t('simulator.simulateJoin')}
                onClick={() => void sendEvent('join')}
              />
            )}
          </Stack>
        </Box>

        {/* Message Stream */}
        <Box
          ref={streamRef}
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          {messages.map((msg) => (
            <Box
              key={msg.id}
              sx={{
                alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
              }}
            >
              <Paper
                elevation={1}
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: msg.sender === 'user' ? 'primary.main' : 'background.paper',
                  color: msg.sender === 'user' ? 'primary.contrastText' : 'text.primary',
                }}
              >
                {msg.mediaUrl &&
                  (/\.(mp4|mov|webm)(\?|$)/i.test(msg.mediaUrl) ||
                  msg.mediaUrl.startsWith('data:video/') ? (
                    <Box
                      component="video"
                      src={msg.mediaUrl}
                      controls
                      sx={{
                        width: '100%',
                        borderRadius: 1,
                        mb: 1,
                        maxHeight: 180,
                      }}
                    />
                  ) : (
                    <Box
                      component="img"
                      src={msg.mediaUrl}
                      alt={t('simulator.mediaAlt')}
                      sx={{
                        width: '100%',
                        borderRadius: 1,
                        mb: 1,
                        maxHeight: 180,
                        objectFit: 'cover',
                      }}
                    />
                  ))}
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {msg.text}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    textAlign: 'right',
                    mt: 0.5,
                    opacity: 0.7,
                    fontSize: '0.6875rem',
                  }}
                >
                  {msg.time}
                </Typography>
              </Paper>

              {/* Bot Inline Buttons */}
              {msg.buttons && msg.buttons.length > 0 && (
                <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                  {msg.buttons.map((btn, bIdx) => (
                    <Button
                      key={bIdx}
                      variant="contained"
                      size="small"
                      color="inherit"
                      fullWidth
                      endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                      onClick={() => void pressButton(btn)}
                      sx={{
                        bgcolor: (th) => (th.palette.mode === 'dark' ? '#253547' : '#e3edf7'),
                        color: 'primary.main',
                        textTransform: 'none',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        py: 0.5,
                        '&:hover': {
                          bgcolor: (th) => (th.palette.mode === 'dark' ? '#2e435a' : '#d2e4f5'),
                        },
                      }}
                    >
                      {btn.text}
                    </Button>
                  ))}
                </Stack>
              )}
            </Box>
          ))}

          {loading && (
            <Box
              sx={{ alignSelf: 'flex-start', p: 1.5, borderRadius: 2, bgcolor: 'background.paper' }}
            >
              <CircularProgress size={16} sx={{ mr: 1, verticalAlign: 'middle' }} />
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {t('simulator.typing')}
              </Typography>
            </Box>
          )}
        </Box>

        <Divider />

        {/* Surface switcher: private chat vs sandbox supergroup */}
        <Box sx={{ px: 2, pt: 1.5, bgcolor: 'background.paper' }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={surface}
            onChange={(_, next) => next && setSurface(next)}
            fullWidth
          >
            <ToggleButton value="private">{t('simulator.surfacePrivate')}</ToggleButton>
            <ToggleButton value="supergroup">{t('simulator.surfaceGroup')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* Input Bar */}
        <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
          <TextField
            fullWidth
            size="small"
            placeholder={t('simulator.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendMessage();
            }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      color="primary"
                      disabled={!input.trim() || loading}
                      onClick={() => void sendMessage()}
                      aria-label={t('simulator.sendMessageAria')}
                    >
                      <SendIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
      </Drawer>
    </>
  );
}
