import { useParams } from 'react-router-dom'
import HelperPhone from '../phones/HelperPhone'
import PhoneFrame from '../phones/PhoneFrame'
import ResidentPhone from '../phones/ResidentPhone'

/** Full-screen phone views for opening on a teammate's device (or a second browser tab). */
export function ResidentPage() {
  const { id = 'margaret' } = useParams()
  return (
    <div className="h-dvh">
      <PhoneFrame bare>
        <ResidentPhone id={id} />
      </PhoneFrame>
    </div>
  )
}

export function HelperPage() {
  const { id = 'daniel' } = useParams()
  return (
    <div className="h-dvh">
      <PhoneFrame bare>
        <HelperPhone id={id} />
      </PhoneFrame>
    </div>
  )
}
