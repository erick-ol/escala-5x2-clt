import { gapKey, type Gap } from '../../domain/coverage';
import { effectiveShiftId, findShift, formatTime, weekOf, weekdayOf } from '../../domain/time';
import { WEEKDAY_NAMES, type CoverageMark, type Coverer } from '../../domain/types';
import { appStore, useAppStore } from '../../state/store';
import { roleName, shiftName } from './labels';
import { Sheet } from './Sheet';

export interface GapSheetProps {
  /** null quando a vaga deixou de faltar depois de uma edição. */
  gap: Gap | null;
  mark?: CoverageMark;
  onClose(): void;
}

function sameCoverer(a: Coverer | undefined, b: Coverer) {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === 'owner' || (b.kind === 'employee' && a.employeeId === b.employeeId);
}

/** Folha de um buraco: marcar "coberto por mim/família" ou por alguém da equipe (R14, R14b). */
export function GapSheet({ gap, mark, onClose }: GapSheetProps) {
  const doc = useAppStore((s) => s.document);

  const footer = (
    <button type="button" className="btn btn-primary" onClick={onClose}>
      Fechar
    </button>
  );

  if (!gap) {
    return (
      <Sheet title="Vaga resolvida" onClose={onClose} footer={footer} tone="gap">
        <p>Esta vaga não está mais faltando.</p>
      </Sheet>
    );
  }

  const { config, employees, schedule } = doc;
  const key = gapKey(gap);
  const shift = findShift(config, gap.shiftId);
  const role = roleName(config, gap.roleId);

  const setCoverer = (coveredBy: Coverer) => {
    const marks = appStore.getState().document.marks.filter((m) => gapKey(m) !== key);
    appStore.getState().setMarks([...marks, { day: gap.day, shiftId: gap.shiftId, roleId: gap.roleId, slot: gap.slot, coveredBy }]);
  };
  const clearMark = () => {
    appStore.getState().setMarks(appStore.getState().document.marks.filter((m) => gapKey(m) !== key));
  };

  const people = employees.map((e) => {
    const cell = schedule?.[e.id]?.[gap.day];
    const off = cell?.status !== 'work';
    const status = off ? 'de folga' : `trabalha ${shiftName(config, effectiveShiftId(config, e, cell, gap.day)).toLowerCase()}`;
    return { e, off, status };
  });
  people.sort((a, b) => Number(b.off) - Number(a.off));

  const coveredName = mark
    ? mark.coveredBy.kind === 'owner'
      ? 'Dono/família'
      : (employees.find((e) => mark.coveredBy.kind === 'employee' && e.id === mark.coveredBy.employeeId)?.name ?? '')
    : null;

  return (
    <Sheet
      tone="gap"
      kicker={`Semana ${weekOf(gap.day) + 1} · ${WEEKDAY_NAMES[weekdayOf(gap.day)]}`}
      title={`Falta ${role.toLowerCase()} · ${shiftName(config, gap.shiftId).toLowerCase()}`}
      onClose={onClose}
      footer={footer}
    >
      {shift && (
        <p className="hint">
          Turno <span className="mono">{formatTime(shift.start)}–{formatTime(shift.end)}</span>. Quem cobrir faz o horário
          padrão do turno.
        </p>
      )}

      <p className={`gap-status ${coveredName ? 'is-covered' : 'is-open'}`} role="status">
        <span aria-hidden="true">{coveredName ? '✓' : '▲'}</span>
        {coveredName ? `Coberto por ${coveredName}` : 'Sem ninguém nesta vaga'}
      </p>

      <button
        type="button"
        className="btn gap-owner"
        aria-pressed={sameCoverer(mark?.coveredBy, { kind: 'owner' })}
        onClick={() => setCoverer({ kind: 'owner' })}
      >
        Coberto por mim/família
      </button>

      <h3 className="sheet-subtitle">Coberto por</h3>
      <ul className="coverer-list">
        {people.map(({ e, off, status }) => {
          const pressed = sameCoverer(mark?.coveredBy, { kind: 'employee', employeeId: e.id });
          return (
            <li key={e.id}>
              <button
                type="button"
                className={`coverer${off ? ' is-off' : ''}`}
                aria-pressed={pressed}
                aria-label={`${e.name}, ${status}`}
                onClick={() => setCoverer({ kind: 'employee', employeeId: e.id })}
              >
                <span className="coverer-name">{e.name}</span>
                <span className="coverer-status">{status}</span>
                {pressed && (
                  <span className="coverer-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {mark && (
        <button type="button" className="btn btn-ghost gap-undo" onClick={clearMark}>
          Desfazer marcação
        </button>
      )}
    </Sheet>
  );
}
