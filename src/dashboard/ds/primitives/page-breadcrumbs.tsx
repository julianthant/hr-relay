import { Fragment } from 'react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from './breadcrumb.js';

export function PageBreadcrumbs({ items, label = 'Breadcrumb' }: {
  items: readonly { label: string; onClick?: () => void }[];
  label?: string;
}) {
  return <Breadcrumb aria-label={label}>
    <BreadcrumbList>
      {items.map((item, index) => <Fragment key={`${index}:${item.label}`}>
        {index > 0 && <BreadcrumbSeparator />}
        <BreadcrumbItem className="max-w-full">
          {index === items.length - 1 ? <BreadcrumbPage className="break-words [overflow-wrap:anywhere]">{item.label}</BreadcrumbPage>
            : item.onClick ? <BreadcrumbLink asChild><button type="button" className="bg-transparent p-0 text-left [overflow-wrap:anywhere]" onClick={item.onClick}>{item.label}</button></BreadcrumbLink>
              : <span className="break-words [overflow-wrap:anywhere]">{item.label}</span>}
        </BreadcrumbItem>
      </Fragment>)}
    </BreadcrumbList>
  </Breadcrumb>;
}
