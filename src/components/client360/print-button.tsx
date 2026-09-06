'use client';
import { Printer } from 'lucide-react';

export function PrintButton() {
  return (
    <button className="btn btn-primary" onClick={() => window.print()}>
      <Printer size={14} /> Download as PDF / Print
    </button>
  );
}
