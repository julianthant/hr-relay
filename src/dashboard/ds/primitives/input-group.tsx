import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

export function InputGroup({ className, ...props }: ComponentProps<'form'>) {
  return <form data-slot="input-group" role="group" className={cn('hub-composer', className)} {...props} />;
}
export function InputGroupTextarea(props: ComponentProps<'textarea'>) {
  return <textarea data-slot="input-group-control" {...props} />;
}
export function InputGroupAddon({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-group-addon" data-align="block-end" role="group" className={cn('hub-toolbar', className)} {...props} />;
}
export function InputGroupButton({ size = 'icon-sm', className, ...props }: ComponentProps<'button'> & { size?: 'icon-sm' | 'sm' }) {
  return <button type="button" data-slot="input-group-button" data-size={size} className={cn('hub-input-button', className)} {...props} />;
}
