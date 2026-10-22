import { BookOpen, Library, CalendarDays } from 'lucide-react';
import type { CollectionSummary } from '../../domain/types.ts';

export function CollectionCounts({ summary }: { summary: CollectionSummary }) {
  const stats = [
    { label: 'Physical manga copies', value: summary.physicalCopies, Icon: BookOpen },
    { label: 'Unique series', value: summary.uniqueSeries, Icon: Library },
    { label: 'Acquisition dates', value: summary.distinctAcquisitionDates, Icon: CalendarDays },
  ];
  return <dl className="my-6 grid gap-4 sm:grid-cols-3">
    {stats.map(({ label, value, Icon }) => <div key={label} className="rounded border border-stone-300 p-4">
      <dt className="flex items-center gap-2 text-sm"><Icon size={18} aria-hidden="true" />{label}</dt>
      <dd className="mt-2 text-3xl font-semibold">{value}</dd>
    </div>)}
  </dl>;
}
