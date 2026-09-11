import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import ServiceCard from '../components/ServiceCard.jsx'
import { isPlainClick, useOpenExternal } from '../components/InAppBrowser.jsx'
import { BookIcon, CallIcon, ChatIcon, CoinIcon, ScaleIcon } from '../components/Icons.jsx'
import logoUrl from '../assets/logo-asknelson.png'
import { track } from '../lib/analytics.js'

const KAELO_URL = 'https://www.kaelo.co.za/request-a-session/'

// The AskNelson helpline. `tel:` needs the digits unspaced; the spaced form is
// what we show on the button.
const HELPLINE = '0800 635 766'
const HELPLINE_TEL = 'tel:0800635766'

const services = [
  {
    title: 'Talk to a Counsellor',
    description: "Confidential support for whatever you're going through",
    Icon: ChatIcon,
  },
  {
    title: 'Connect with a Life Coach',
    description: 'Work through your goals, decisions, or life direction',
    Icon: BookIcon,
  },
  {
    title: 'Need Financial Advice?',
    description: 'Practical guidance on money and financial stress',
    Icon: CoinIcon,
  },
  {
    title: 'Need a Legal Advisor?',
    description: 'Get clear, practical advice on legal matters or questions',
    Icon: ScaleIcon,
  },
]

export default function AskNelson() {
  const openExternal = useOpenExternal()

  // The Kaelo form allows framing, so booking happens without leaving the app.
  const book = (service) => (e) => {
    track('booking_clicked', { service })
    if (!isPlainClick(e)) return
    e.preventDefault()
    openExternal(KAELO_URL, { title: 'Book a session', type: 'booking', record: false })
  }

  return (
    <div className="page-enter px-5 pb-8 lg:px-0">
      <div className="pt-[calc(1.5rem+env(safe-area-inset-top,0px))] lg:pt-0">
        <img src={logoUrl} alt="AskNelson" className="h-9 w-auto" />
      </div>

      <div className="mt-7">
        <h1 className="font-display text-[30px] font-extrabold leading-tight text-navy lg:text-[38px]">
          We're Here to Help
        </h1>
        <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-slate-500">
          Access trusted support from qualified professionals. Real support from real people.
        </p>
      </div>
      {/* SOS — deliberately large and urgent */}
        {/* <a
          href={KAELO_URL}
          target="_blank"
          rel="noopener noreferrer"
          // Urgent-help taps are the signal the EAP team most needs to see, so
          // flush immediately rather than waiting for the next batch.
          onClick={() => {
            track('sos_pressed', { destination: KAELO_URL })
            flushNow()
          }}
          className="mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-card
                     bg-red-600 px-5 text-[15px] font-bold text-white shadow-sm
                     transition-transform duration-100 active:scale-[0.98]"
        >
          <AlertIcon className="h-5 w-5 shrink-0" />
          I need help right now
        </a> */}

      <motion.div
        variants={listContainer}
        initial="hidden"
        animate="show"
        className="mt-6 grid grid-cols-2 gap-4 lg:gap-5"
      >
        {services.map((s) => (
          <motion.div key={s.title} variants={listItem}>
            <ServiceCard
              title={s.title}
              description={s.description}
              Icon={s.Icon}
              href={KAELO_URL}
              onClick={book(s.title)}
            />
          </motion.div>
        ))}
      </motion.div>

      {/* SOS — deliberately large and urgent, and the only red in the app.
          Tapping it dials the AskNelson helpline. */}
      <a
        href={HELPLINE_TEL}
        className="mt-6 flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-btn
                   bg-danger px-5 text-white
                   transition active:scale-[0.99]"
      >
        <CallIcon className="h-5 w-5 shrink-0" />
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[16px] font-extrabold">Get Help Now</span>
          <span className="text-[13px] font-bold text-white/85">{HELPLINE}</span>
        </span>
      </a>

      <p className="mt-6 text-center text-[12px] leading-relaxed text-slate-400">
        All consultations are confidential and covered by your employer.
      </p>
    </div>
  )
}
