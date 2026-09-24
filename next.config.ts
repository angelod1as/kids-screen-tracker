import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";

import { baseConfig } from "./next.config.base";

// A missing item fails the build by name instead of shipping `undefined`;
// `next dev` only reports it and keeps serving, on purpose.
const withVarlock = varlockNextConfigPlugin();

export default withVarlock(baseConfig);
