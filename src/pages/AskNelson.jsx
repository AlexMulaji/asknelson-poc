import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import ServiceCard from '../components/ServiceCard.jsx'
import { AlertIcon, ChatIcon, CoinIcon, IdCardIcon, ScaleIcon } from '../components/Icons.jsx'
import logoUrl from '../assets/logo-asknelson.png'

const KAELO_URL = 'https://www.kaelo.co.za/kaelo-lifestyle/'

const services = [
  {
    title: 'Talk to a Counsellor',
    description: "Confidential support for whatever you're going through",
    Icon: ChatIcon,
  },
  {
    title: 'Connect with a Life Coach',
    description: 'Work through your goals, decisions, or life direction',
    Icon: IdCardIcon,
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
            />
          </motion.div>
        ))}
      </motion.div>

      {/* SOS — deliberately large and urgent, and the only red in the app. */}
      <a
        href={KAELO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-btn
                   bg-danger px-5 text-[16px] font-extrabold text-white
                   transition active:scale-[0.99]"
      >
        <AlertIcon className="h-5 w-5 shrink-0" />
        Get Help Now
      </a>

      <p className="mt-6 text-center text-[12px] leading-relaxed text-slate-400">
        All consultations are confidential and covered by your employer.
      </p>
    </div>
  )
}
