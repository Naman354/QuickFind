import React from 'react';

interface StatusBadgeProps {
  status: 'healthy' | 'degraded' | 'error' | 'pending';
  label?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const displayLabel = label || status.toUpperCase();

  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />
      <span className="status-text">{displayLabel}</span>
    </span>
  );
};

