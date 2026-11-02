import { AuthenticatorSetup } from "../../../../ui/AuthenticatorSetup.js";
import { AuthenticatorDemo } from "../../../../ui/AuthenticatorDemo.js";
import { request, describeError } from "../../api/client.js";

export function AuthenticatorPage() {
  return <AuthenticatorSetup prefix="/v1/auth" request={request} describeError={describeError} plane="merchant" unavailableDemo={<AuthenticatorDemo />} />;
}
