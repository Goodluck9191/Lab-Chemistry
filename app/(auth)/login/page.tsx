import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Sign in" };

/**
 * `next` is validated here as well as in the action: only a single-slash,
 * relative path is accepted, so a crafted ?next= link cannot turn the login page
 * into an open redirect.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const raw = params.next;
  const nextPath =
    typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : undefined;

  return (
    <Card>
      <CardHeader
        title="Sign in"
        description="Use the account your instructor set up, or register a new student account."
      />
      <CardBody className="flex flex-col gap-5">
        <LoginForm nextPath={nextPath} />
        <p className="text-sm text-muted">
          No account yet?{" "}
          <Link href="/register" className="font-medium text-primary underline">
            Register as a student
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
