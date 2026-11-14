import { useAppStore } from '../state/store';
import './schedule/schedule.css';

/** Aviso fixo (R19): o navegador não deixa salvar nada neste aparelho. */
export function StorageWarning() {
  const available = useAppStore((s) => s.storageAvailable);
  const unreadable = useAppStore((s) => s.recoveredUnreadable);
  if (unreadable) {
    return (
      <div className="storage-warning" role="status">
        <span className="storage-warning-icon" aria-hidden="true">
          !
        </span>
        <p>
          A escala salva neste aparelho não pôde ser lida. Guardamos uma cópia dela; se você tiver um backup, use
          "Restaurar backup".
        </p>
      </div>
    );
  }
  if (available) return null;
  return (
    <div className="storage-warning" role="status">
      <span className="storage-warning-icon" aria-hidden="true">
        !
      </span>
      <p>Seus dados não estão sendo salvos neste aparelho. Baixe um backup antes de sair.</p>
    </div>
  );
}
