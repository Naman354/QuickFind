import React from 'react';

interface InfoItem {
  label: string;
  value: string | number | boolean;
  highlight?: boolean;
}

interface InfoCardProps {
  title: string;
  subtitle?: string;
  items: InfoItem[];
  icon?: React.ReactNode;
}

export const InfoCard: React.FC<InfoCardProps> = ({ title, subtitle, items, icon }) => {
  return (
    <div className="info-card">
      <div className="info-card-header">
        {icon && <div className="info-card-icon">{icon}</div>}
        <div>
          <h3 className="info-card-title">{title}</h3>
          {subtitle && <p className="info-card-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="info-card-body">
        {items.map((item, idx) => (
          <div key={idx} className="info-row">
            <span className="info-label">{item.label}</span>
            <span className={`info-value ${item.highlight ? 'info-highlight' : ''}`}>
              {typeof item.value === 'boolean' ? (item.value ? 'Active' : 'Disabled') : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

