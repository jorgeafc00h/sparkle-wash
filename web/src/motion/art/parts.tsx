import type { CSSProperties } from "react";
import { TICKET_COPY, WORK_TICKET_NUMBER, type SceneLang } from "../copy";
import "./parts.css";

/** A licence plate drawn like the console draws it: white plate, blue band, monospace characters. */
export function Plate({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={["cs-m-plate", className].filter(Boolean).join(" ")} style={style}>
      <span className="cs-m-plate__band" />
      {text}
    </span>
  );
}

/** The printed work order, with the same fields the desktop app prints (no prices on the marketing site). */
export function WorkTicket({ lang, number = WORK_TICKET_NUMBER, plate = "P903377" }: { lang: SceneLang; number?: string; plate?: string }) {
  const t = TICKET_COPY[lang];
  return (
    <div className="cs-m-ticket">
      <p className="cs-m-ticket__title">{t.title}</p>
      <p className="cs-m-ticket__num">{number}</p>
      <hr />
      <p className="cs-m-ticket__plate">{plate}</p>
      <p>{t.vehicle}</p>
      <hr />
      <p className="cs-m-ticket__paid">{t.paid}</p>
      <p className="cs-m-ticket__note">{t.note}</p>
    </div>
  );
}

/** A thermal receipt printer; the ticket feeds out of its slot (`.cs-m-printer__paper` animates translateY). */
export function Printer({ lang, className }: { lang: SceneLang; className?: string }) {
  return (
    <div className={["cs-m-printer", className].filter(Boolean).join(" ")}>
      <div className="cs-m-printer__body">
        <span className="cs-m-printer__led" />
        <span className="cs-m-printer__slot" />
      </div>
      <div className="cs-m-printer__out">
        <div className="cs-m-printer__paper">
          <WorkTicket lang={lang} />
        </div>
      </div>
    </div>
  );
}

export function CheckIcon() {
  return (
    <svg className="cs-m-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
