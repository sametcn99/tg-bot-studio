import React, { useState } from 'react';
import { tmaFetch } from '../api';
import { haptic, isInsideTelegram } from '../sdk/telegram';
import { createT } from '../i18n';
import type { TmaAppConfig } from '../App';

/**
 * Dynamic form field definition from the Forms template config.
 * @interface FormField
 * @property {string} label - Field label shown to the user.
 * @property {'text'|'phone'|'file'|'select'} type - Input type.
 * @property {boolean} [required] - Whether the field must be filled.
 * @property {string[]} [options] - Choices for select fields.
 */
interface FormField {
  label: string;
  type: 'text' | 'phone' | 'file' | 'select';
  required?: boolean;
  options?: string[];
}

/**
 * Dynamic Forms & Lead Capture template. Renders configured custom fields
 * (text, phone, file link, multiple choice) and records submissions in the
 * studio for CSV export.
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement} The form view.
 */
export default function Forms({ config }: { config: TmaAppConfig }): React.ReactElement {
  const t = createT(config.config);
  const fields = (config.config.fields as FormField[]) ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Submits the completed form.
   * @returns {Promise<void>} Resolves after the server acknowledged.
   */
  async function submit(): Promise<void> {
    for (const field of fields) {
      if (field.required && !answers[field.label]) {
        setStatus(t('forms.fieldRequired', '"{field}" is required.', { field: field.label }));
        return;
      }
    }
    setBusy(true);
    setStatus(null);
    try {
      await tmaFetch(`/api/tma/${config.slug}/form-submit`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      });
      haptic('medium');
      setAnswers({});
      setStatus(t('forms.submitted', 'Submission received. Thank you.'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('forms.failed', 'Submission failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {fields.map((field) => (
          <div key={field.label} className="field">
            <label>
              {field.label}
              {field.required ? ' *' : ''}
            </label>
            {field.type === 'select' ? (
              <select
                value={answers[field.label] ?? ''}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [field.label]: event.target.value }))
                }
              >
                <option value="">{t('forms.selectOption', 'Select an option')}</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === 'phone' ? 'tel' : 'text'}
                placeholder={
                  field.type === 'file'
                    ? t('forms.filePlaceholder', 'Paste a file link (https://...)')
                    : undefined
                }
                value={answers[field.label] ?? ''}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [field.label]: event.target.value }))
                }
              />
            )}
          </div>
        ))}
        {fields.length === 0 && (
          <div className="muted">{t('forms.noFields', 'No fields configured yet.')}</div>
        )}
      </div>
      <button
        className="primary"
        onClick={() => void submit()}
        disabled={busy || fields.length === 0 || !isInsideTelegram()}
      >
        {busy ? t('common.submitting', 'Submitting...') : t('forms.submit', 'Submit')}
      </button>
      {status && (
        <div className="success-text" role="status" aria-live="polite">
          {status}
        </div>
      )}
    </>
  );
}
