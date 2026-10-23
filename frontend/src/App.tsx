import { Route, Routes } from "react-router";
import { ProblemForm } from "./pages/ProblemForm";
import { ProblemList } from "./pages/ProblemList";
import { SessionPage } from "./pages/SessionPage";

/** Top-level routes (plan.md "Deploy"). */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<ProblemList />} />
      <Route path="/problems/new" element={<ProblemForm />} />
      <Route path="/problems/:id/edit" element={<ProblemForm />} />
      <Route path="/s/:invite" element={<SessionPage />} />
    </Routes>
  );
}
