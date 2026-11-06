import { patternApp } from '../../lib/edge';
import { PatternMcpAgentCoreCloudFrontStack } from './stack';

patternApp('PatternMcpAgentCoreCloudFront', (app, id, props) => new PatternMcpAgentCoreCloudFrontStack(app, id, props));
