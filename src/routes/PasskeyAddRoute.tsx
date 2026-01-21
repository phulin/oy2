import { useAppContext } from "../AppContext";
import { PasskeySetupScreen } from "../components/PasskeySetupScreen";

export function PasskeyAddRoute() {
	const { passkeyAddComplete, passkeyAddCancel } = useAppContext();

	return (
		<PasskeySetupScreen
			onComplete={passkeyAddComplete}
			onSkip={passkeyAddCancel}
		/>
	);
}
