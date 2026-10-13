import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ViewQuiltIcon from '@mui/icons-material/ViewQuilt';
import CodeIcon from '@mui/icons-material/Code';
import { useTranslation } from 'react-i18next';

interface VisualMiniAppConfigBuilderProps {
  templateType: string;
  config: Record<string, unknown>;
  onChange: (newConfig: Record<string, unknown>) => void;
}

export default function VisualMiniAppConfigBuilder({
  templateType,
  config,
  onChange,
}: VisualMiniAppConfigBuilderProps): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState(JSON.stringify(config, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    setJsonText(JSON.stringify(config, null, 2));
  }, [config]);

  const handleJsonBlur = (val: string) => {
    try {
      const parsed = JSON.parse(val);
      setJsonError(null);
      onChange(parsed);
    } catch {
      setJsonError('Invalid JSON format');
    }
  };

  /* ----- E-Commerce Builder ----- */
  const products = (config.products as Array<Record<string, unknown>>) ?? [];
  const updateProducts = (next: Array<Record<string, unknown>>) => {
    onChange({ ...config, products: next });
  };
  const addProduct = () => {
    const newId = `prod_${Date.now()}`;
    updateProducts([
      ...products,
      { id: newId, title: 'New Item', price: 10, description: '', imageUrl: '' },
    ]);
  };
  const removeProduct = (idx: number) => {
    updateProducts(products.filter((_, i) => i !== idx));
  };
  const updateProductField = (idx: number, field: string, val: unknown) => {
    const next = [...products];
    next[idx] = { ...next[idx], [field]: val };
    updateProducts(next);
  };

  /* ----- Forms Builder ----- */
  const fields = (config.fields as Array<Record<string, unknown>>) ?? [];
  const updateFields = (next: Array<Record<string, unknown>>) => {
    onChange({ ...config, fields: next });
  };
  const addField = () => {
    updateFields([
      ...fields,
      { label: 'Full Name', type: 'text', required: true },
    ]);
  };
  const removeField = (idx: number) => {
    updateFields(fields.filter((_, i) => i !== idx));
  };
  const updateFormField = (idx: number, key: string, val: unknown) => {
    const next = [...fields];
    next[idx] = { ...next[idx], [key]: val };
    updateFields(next);
  };

  /* ----- Spin Builder ----- */
  const prizes = (config.prizes as Array<Record<string, unknown>>) ?? [];
  const updatePrizes = (next: Array<Record<string, unknown>>) => {
    onChange({ ...config, prizes: next });
  };
  const addPrize = () => {
    updatePrizes([...prizes, { label: '50 Points', points: 50 }]);
  };
  const removePrize = (idx: number) => {
    updatePrizes(prizes.filter((_, i) => i !== idx));
  };
  const updatePrizeField = (idx: number, key: string, val: unknown) => {
    const next = [...prizes];
    next[idx] = { ...next[idx], [key]: val };
    updatePrizes(next);
  };

  /* ----- Loyalty Builder ----- */
  const tiers = (config.tiers as Array<Record<string, unknown>>) ?? [];
  const updateTiers = (next: Array<Record<string, unknown>>) => {
    onChange({ ...config, tiers: next });
  };
  const addTier = () => {
    updateTiers([...tiers, { name: 'Gold', minPoints: 500 }]);
  };
  const removeTier = (idx: number) => {
    updateTiers(tiers.filter((_, i) => i !== idx));
  };
  const updateTierField = (idx: number, key: string, val: unknown) => {
    const next = [...tiers];
    next[idx] = { ...next[idx], [key]: val };
    updateTiers(next);
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'background.paper' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {t('miniApps.config')} ({templateType})
        </Typography>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.5, fontSize: '0.75rem' } }}
        >
          <Tab icon={<ViewQuiltIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={t('miniApps.visualEditor')} value="visual" />
          <Tab icon={<CodeIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={t('miniApps.rawJsonEditor')} value="json" />
        </Tabs>
      </Stack>

      {tab === 'visual' ? (
        <Box>
          {templateType === 'ecommerce' && (
            <Stack spacing={2}>
              <Typography variant="caption" color="text.secondary">
                Configure your product catalog. Items are shown in the Telegram storefront.
              </Typography>
              {products.map((prod, idx) => (
                <Paper key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.default' }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        label="Product Title"
                        value={String(prod.title ?? '')}
                        onChange={(e) => updateProductField(idx, 'title', e.target.value)}
                        sx={{ flex: 2 }}
                      />
                      <TextField
                        size="small"
                        label="Price (Stars)"
                        type="number"
                        value={Number(prod.price ?? 0)}
                        onChange={(e) => updateProductField(idx, 'price', Number(e.target.value))}
                        sx={{ flex: 1 }}
                      />
                      <Tooltip title={t('actions.delete')}>
                        <IconButton size="small" color="error" onClick={() => removeProduct(idx)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        size="small"
                        label="Image URL"
                        placeholder="https://..."
                        value={String(prod.imageUrl ?? '')}
                        onChange={(e) => updateProductField(idx, 'imageUrl', e.target.value)}
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        size="small"
                        label="Description"
                        value={String(prod.description ?? '')}
                        onChange={(e) => updateProductField(idx, 'description', e.target.value)}
                        sx={{ flex: 1 }}
                      />
                    </Stack>
                  </Stack>
                </Paper>
              ))}
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addProduct} sx={{ alignSelf: 'flex-start' }}>
                Add Product
              </Button>
            </Stack>
          )}

          {templateType === 'forms' && (
            <Stack spacing={2}>
              <Typography variant="caption" color="text.secondary">
                Configure form inputs. Responses are recorded in the forms table.
              </Typography>
              {fields.map((f, idx) => (
                <Paper key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.default' }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <TextField
                      size="small"
                      label="Field Label"
                      value={String(f.label ?? '')}
                      onChange={(e) => updateFormField(idx, 'label', e.target.value)}
                      sx={{ flex: 2 }}
                    />
                    <TextField
                      size="small"
                      select
                      label="Input Type"
                      value={String(f.type ?? 'text')}
                      onChange={(e) => updateFormField(idx, 'type', e.target.value)}
                      sx={{ flex: 1 }}
                    >
                      <MenuItem value="text">Text</MenuItem>
                      <MenuItem value="phone">Phone</MenuItem>
                      <MenuItem value="file">File Link</MenuItem>
                      <MenuItem value="select">Dropdown</MenuItem>
                    </TextField>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={Boolean(f.required)}
                          onChange={(e) => updateFormField(idx, 'required', e.target.checked)}
                        />
                      }
                      label={<Typography variant="caption">Required</Typography>}
                    />
                    <Tooltip title={t('actions.delete')}>
                      <IconButton size="small" color="error" onClick={() => removeField(idx)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              ))}
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addField} sx={{ alignSelf: 'flex-start' }}>
                Add Form Field
              </Button>
            </Stack>
          )}

          {templateType === 'spin' && (
            <Stack spacing={2}>
              <Typography variant="caption" color="text.secondary">
                Configure wheel slices and point prizes.
              </Typography>
              {prizes.map((prz, idx) => (
                <Paper key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.default' }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <TextField
                      size="small"
                      label="Prize Label"
                      value={String(prz.label ?? '')}
                      onChange={(e) => updatePrizeField(idx, 'label', e.target.value)}
                      sx={{ flex: 2 }}
                    />
                    <TextField
                      size="small"
                      label="Points"
                      type="number"
                      value={Number(prz.points ?? 0)}
                      onChange={(e) => updatePrizeField(idx, 'points', Number(e.target.value))}
                      sx={{ flex: 1 }}
                    />
                    <Tooltip title={t('actions.delete')}>
                      <IconButton size="small" color="error" onClick={() => removePrize(idx)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              ))}
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addPrize} sx={{ alignSelf: 'flex-start' }}>
                Add Prize Slice
              </Button>
            </Stack>
          )}

          {templateType === 'loyalty' && (
            <Stack spacing={2}>
              <Typography variant="caption" color="text.secondary">
                Configure loyalty rank tiers.
              </Typography>
              {tiers.map((tr, idx) => (
                <Paper key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.default' }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <TextField
                      size="small"
                      label="Tier Name"
                      value={String(tr.name ?? '')}
                      onChange={(e) => updateTierField(idx, 'name', e.target.value)}
                      sx={{ flex: 2 }}
                    />
                    <TextField
                      size="small"
                      label="Min Points Required"
                      type="number"
                      value={Number(tr.minPoints ?? 0)}
                      onChange={(e) => updateTierField(idx, 'minPoints', Number(e.target.value))}
                      sx={{ flex: 1 }}
                    />
                    <Tooltip title={t('actions.delete')}>
                      <IconButton size="small" color="error" onClick={() => removeTier(idx)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              ))}
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addTier} sx={{ alignSelf: 'flex-start' }}>
                Add Tier Level
              </Button>
            </Stack>
          )}

          {templateType === 'webview' && (
            <Stack spacing={2}>
              <TextField
                label="Target Webview URL"
                size="small"
                fullWidth
                placeholder="https://example.com"
                value={String(config.url ?? '')}
                onChange={(e) => onChange({ ...config, url: e.target.value })}
                helperText="Must support HTTPS. Make sure the target site does not block framing (X-Frame-Options)."
              />
            </Stack>
          )}
        </Box>
      ) : (
        <Stack spacing={1}>
          <TextField
            multiline
            minRows={8}
            size="small"
            fullWidth
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            onBlur={(e) => handleJsonBlur(e.target.value)}
            error={Boolean(jsonError)}
            helperText={jsonError ?? 'Edit raw JSON configuration directly'}
          />
        </Stack>
      )}
    </Box>
  );
}
