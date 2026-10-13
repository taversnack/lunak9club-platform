'use client';
import { useState } from 'react';
import s from './ui.module.css';
import { TextField, useField } from './form';

/**
 * One vaccine on the upload form. Its two dates are asked for (and required) only once it's
 * ticked: a record usually covers only some vaccines, and unticked ones need nothing.
 */
export function VaccineChoice({ vaccineKey, label, today }: { vaccineKey: string; label: string; today: string }) {
  const givenError = useField(`administeredOn.${vaccineKey}`).error;
  const untilError = useField(`expiresOn.${vaccineKey}`).error;
  const [ticked, setTicked] = useState(Boolean(givenError || untilError));
  return (
    <div className={s.card} style={{ padding: 'var(--space-3)' }}>
      <label className={s.choice}>
        <input
          type="checkbox"
          name="covers"
          value={vaccineKey}
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {ticked ? (
        <>
          <TextField
            name={`administeredOn.${vaccineKey}`}
            label={`${label}: date given`}
            type="date"
            required
            max={today}
          />
          <TextField name={`expiresOn.${vaccineKey}`} label={`${label}: valid until`} type="date" required />
        </>
      ) : null}
    </div>
  );
}
