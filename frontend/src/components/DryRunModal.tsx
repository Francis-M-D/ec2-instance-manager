import Modal from './Modal'
import Button from './Button'
import { ActionResult } from '../api/instances'

interface Props {
  open: boolean
  onClose: () => void
  result: ActionResult | null
  action: 'start' | 'stop'
  onConfirm: () => void
  confirming: boolean
}

export default function DryRunModal({ open, onClose, result, action, onConfirm, confirming }: Props) {
  const acted = action === 'start' ? result?.wouldStart : result?.wouldStop

  return (
    <Modal open={open} onClose={onClose} title={`Dry run — ${action}`} wide>
      {result && (
        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-1 font-medium text-emerald-700">Would {action} ({acted?.length ?? 0})</p>
            <ul className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
              {(acted ?? []).map((id) => (
                <li key={id}>{id}</li>
              ))}
              {(acted ?? []).length === 0 && <li className="text-emerald-600/60">None</li>}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-medium text-amber-700">Would skip ({result.wouldSkip.length})</p>
            <ul className="rounded-lg bg-amber-50 p-2 text-amber-800">
              {result.wouldSkip.map((s) => (
                <li key={s.instanceId}>
                  {s.instanceId} — {s.reason}
                </li>
              ))}
              {result.wouldSkip.length === 0 && <li className="text-amber-600/60">None</li>}
            </ul>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-rose-700">Errors</p>
              <ul className="rounded-lg bg-rose-50 p-2 text-rose-800">
                {result.errors.map((e, i) => (
                  <li key={i}>{JSON.stringify(e)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={action === 'stop' ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={confirming}
          disabled={!acted || acted.length === 0}
        >
          Confirm {action}
        </Button>
      </div>
    </Modal>
  )
}
