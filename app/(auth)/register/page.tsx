import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Register" };

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader
        title="Create a student account"
        description="Registration always creates a student account. Instructor access is granted by the department, never by signing up."
      />
      <CardBody className="flex flex-col gap-5">
        <RegisterForm />
        <p className="text-sm text-muted">
          Already registered?{" "}
          <Link href="/login" className="font-medium text-primary underline">
            Sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
