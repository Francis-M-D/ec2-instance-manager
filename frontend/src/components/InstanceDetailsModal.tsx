import { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from './Modal'
import Button from './Button'
import { StateBadge, DnsBadge } from './Badge'
import { getInstance, InstanceListItem } from '../api/instances'
import { listLogs } from '../api/logs'

interface Props {
  instance: InstanceListItem
  onClose: () => void
  onAction: (action: 'start' | 'stop') => void
}

export default function InstanceDetailsModal({ instance, onClose, onAction }: Props) {
  const { data: detail } = useQuery({
    queryKey: ['instance', instance.instanceId, instance.accountKey, instance.region],
    queryFn: () => getInstance(instance.instanceId, instance.accountKey, instance.region),
  })

  const { data: logs } = useQuery({
    queryKey: ['instance-logs', instance.instanceId],
    queryFn: () => listLogs({ instanceId: instance.instanceId, pageSize: 5 }),
  })

  return (
    <Modal open onClose={onClose} title={instance.name} wide>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Info label="Instance ID" value={instance.instanceId} />
          <Info label="State" value={<StateBadge state={instance.state} />} />
          <Info label="Protected" value={<DnsBadge enabled={instance.dnsEnabled} />} />
          <Info label="Type" value={instance.instanceType ?? '—'} />
          <Info label="Public IP" value={instance.publicIp ?? '—'} />
          <Info label="Private IP" value={instance.privateIp ?? '—'} />
          <Info label="Region" value={instance.region} />
          <Info label="Account" value={instance.accountKey} />
          <Info label="Launch time" value={instance.launchTime ?? '—'} />
        </div>

        <div>
          <p className="mb-1 font-medium text-slate-700">Tags</p>
          <div className="rounded-lg bg-slate-50 p-2">
            {detail?.tags?.length ? (
              detail.tags.map((t) => (
                <div key={t.key} className="flex justify-between border-b border-slate-100 py-1 last:border-0">
                  <span className="text-slate-500">{t.key}</span>
                  <span className="font-medium text-slate-700">{t.value}</span>
                </div>
              ))
            ) : (
              <span className="text-slate-400">No tags</span>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1 font-medium text-slate-700">Recent actions</p>
          <div className="rounded-lg bg-slate-50 p-2">
            {logs?.items?.length ? (
              logs.items.map((l) => (
                <div key={l.id} className="border-b border-slate-100 py-1 text-xs last:border-0">
                  <span className="text-slate-500">{new Date(l.timestamp).toLocaleString()}</span> —{' '}
                  <span className="font-medium">{l.actionType}</span> — {l.result}
                </div>
              ))
            ) : (
              <span className="text-xs text-slate-400">No recent actions</span>
            )}
          </div>
        </div>

        <div
          className="flex justify-end gap-2 pt-2"
          title={instance.dnsEnabled ? 'Action not allowed: this instance is protected (DNS tag is set to Yes).' : ''}
        >
          <Button variant="secondary" disabled={instance.dnsEnabled} onClick={() => onAction('start')}>
            Start
          </Button>
          <Button variant="danger" disabled={instance.dnsEnabled} onClick={() => onAction('stop')}>
            Stop
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-slate-700">{value}</div>
    </div>
  )
}
