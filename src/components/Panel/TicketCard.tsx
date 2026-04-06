import './TicketCard.css';

const FARES = [
  { label: 'Adult', price: '$9.11' },
  { label: 'Senior / Student', price: '$5.86' },
  { label: 'Child', price: '$4.29' },
  { label: 'Under 2', price: 'Free' },
] as const;

export function TicketCard() {
  const handleBuyTickets = () => {
    window.open('https://secure.toronto.ca/FerryTicketOnline/tickets2/index.jsp', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="ticket-card">
      <h3 className="ticket-card__title">Ferry Tickets</h3>
      <div className="ticket-card__fares">
        {FARES.map(({ label, price }) => (
          <div key={label} className="ticket-card__fare-row">
            <span className="ticket-card__fare-label">{label}</span>
            <span className="ticket-card__fare-price">{price}</span>
          </div>
        ))}
      </div>
      <p className="ticket-card__validity">Valid through Dec 31 of purchase year</p>
      <button
        className="ticket-card__cta"
        onClick={handleBuyTickets}
        type="button"
        aria-label="Buy ferry tickets on the City of Toronto website (opens in new tab)"
      >
        Buy Tickets
      </button>
    </div>
  );
}
