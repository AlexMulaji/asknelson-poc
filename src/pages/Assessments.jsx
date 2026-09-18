import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import PageHeader from '../components/PageHeader.jsx'
import AssessmentCard from '../components/AssessmentCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useAssessmentHistory, retakeInfo } from '../hooks/useAssessmentHistory.js'
import { useContent } from '../hooks/useContent.js'

export default function Assessments() {
  // Data shape: { assessments: [ { id, title, subtitle, color, bg, icon, ... } ] }
  const assessmentsFile = useContent('assessments')
  const assessments = assessmentsFile?.assessments ?? []

  const navigate = useNavigate()
  const { getRecord } = useAssessmentHistory()

  return (
    <div className="page-enter px-5 pb-8 lg:px-0">
      <PageHeader title="Assessments" className="px-0" />

      {assessments.length === 0 ? (
        <div className="pt-6">
          <EmptyState
            title="Your check-ins are on their way"
            message="Assessments load from assessments.json. Once they're added, you'll find short, validated screens here to help you understand how you're really doing."
          />
        </div>
      ) : (
        <>
          <div className="mt-7">
            <h2 className="font-display text-[22px] font-extrabold text-ink lg:text-[26px]">
              Wellbeing Check-in
            </h2>
            <p className="mt-1 max-w-lg text-[14px] leading-relaxed text-slate-500">
              Choose a short self-assessment to better understand your mental wellbeing.
            </p>
          </div>

          <motion.div
            variants={listContainer}
            initial="hidden"
            animate="show"
            className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5"
          >
            {assessments.map((a) => {
              const record = getRecord(a.id)
              return (
                <motion.div key={a.id} variants={listItem}>
                  <AssessmentCard
                    assessment={a}
                    record={record}
                    retake={retakeInfo(record, a.retake_after_days)}
                    onOpen={(id) => navigate(`/assessments/${id}`)}
                  />
                </motion.div>
              )
            })}
          </motion.div>
        </>
      )}
    </div>
  )
}
