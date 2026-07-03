"use client";

import { useState } from "react";

interface AddSectionFormProps {
  onAdd: (name: string) => Promise<unknown>;
  autoFocus?: boolean;
}

/** Name input + submit button for creating a new section in the open menu. */
export default function AddSectionForm({ onAdd, autoFocus = false }: AddSectionFormProps) {
  const [name, setName] = useState("");

  return (
    <form
      className="tt-add-section"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim()) {
          await onAdd(name.trim());
          setName("");
        }
      }}
    >
      <input
        className="tt-input"
        placeholder="New section name (e.g. Coffee Drinks)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus={autoFocus}
      />
      <button className="tt-btn tt-btn-primary" type="submit" disabled={!name.trim()}>
        + Add section
      </button>
    </form>
  );
}
