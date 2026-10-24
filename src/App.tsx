import { BrowserRouter, Route, Routes } from 'react-router-dom'
import CommandCenter from './pages/CommandCenter'
import { HelperPage, ResidentPage } from './pages/PhonePage'
import Register from './pages/Register'
import Stage from './pages/Stage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/stage" element={<Stage />} />
        <Route path="/register" element={<Register />} />
        <Route path="/resident/:id" element={<ResidentPage />} />
        <Route path="/helper/:id" element={<HelperPage />} />
      </Routes>
    </BrowserRouter>
  )
}
