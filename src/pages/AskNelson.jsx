import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import PageHeader from '../components/PageHeader.jsx'
import ServiceCard from '../components/ServiceCard.jsx'
import { AlertIcon, ChatIcon, CompassIcon, CoinIcon, ScaleIcon } from '../components/Icons.jsx'
import logoUrl from '../assets/logo-asknelson.png'

const KAELO_URL = 'https://www.kaelo.co.za/kaelo-lifestyle/'

const services = [
  {
    title: 'Talk to a Counsellor',
    description: "Confidential support for whatever you're going through",
    Icon: ChatIcon,
  },
  {
    title: 'Life Coach',
    description: 'Work through goals, decisions, or direction',
    Icon: CompassIcon,
  },
  {
    title: 'Financial Advisor',
    description: 'Practical guidance on money and financial stress',
    Icon: CoinIcon,
  },
  {
    title: 'Legal Advisor',
    description: 'Advice on legal questions in plain language',
    Icon: ScaleIcon,
  },
]

export default function AskNelson() {
  return (
    <div className="page-enter">
      <PageHeader logo={logoUrl} title="AskNelson" subtitle="Real support from real people" />

      <div className="px-5 pt-4 pb-6 lg:mx-auto lg:max-w-2xl">
        <p className="text-[14px] leading-relaxed text-gray-600">
          Whatever you're going through, we have someone who can help.
        </p>

        {/* SOS — deliberately large and urgent */}
        <a
          href={KAELO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-card
                     bg-red-600 px-5 text-[15px] font-bold text-white shadow-sm
                     transition-transform duration-100 active:scale-[0.98]"
        >
          <AlertIcon className="h-5 w-5 shrink-0" />
          I need help right now
        </a>

        {/* Service grid */}
        <motion.div
          variants={listContainer}
          initial="hidden"
          animate="show"
          className="mt-4 grid grid-cols-2 gap-3"
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

        {/* Footer note */}
        <p className="mt-6 text-center text-[12px] leading-relaxed text-gray-400">
          All consultations are confidential and covered by your employer.
        </p>
      </div>
    </div>
  )
}
