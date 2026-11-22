import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    (dialog?.querySelector<HTMLElement>('input:not([type=file]),select,textarea') ?? dialog?.querySelector<HTMLElement>('.modal-foot button'))?.focus();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog className="modal" ref={ref} aria-labelledby={id} onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  }}><div className="modal-head"><h2 id={id}>{title}</h2><button type="button" className="icon-btn" aria-label="Zamknij okno" onClick={close}><X /></button></div>{children}</dialog>;
}
