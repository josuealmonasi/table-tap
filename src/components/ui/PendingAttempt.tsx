"use client";

interface PendingAttemptProps {
  message: string;
}

/** The request stays visible until sending it again tells us what happened. */
export default function PendingAttempt({ message }: PendingAttemptProps) {
  return <p className="tt-offline-banner" role="status">{message}</p>;
}
