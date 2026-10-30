import { AuthenticatorSetup } from "../../../../ui/AuthenticatorSetup.js";
import { request, describeError } from "../../api/client.js";

export function AuthenticatorPage() {
  return <AuthenticatorSetup prefix="/v1/admin/auth" request={request} describeError={describeError} plane="admin" />;
}
