import { useAppStore } from '../state/store';
import './schedule/schedule.css';

/** Aviso fixo (R19): o navegador não deixa salvar nada neste aparelho. */
export function StorageWarning() {
  const available = useAppStore((s) => s.storageAvailable);
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
