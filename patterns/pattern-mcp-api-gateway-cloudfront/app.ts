import { patternApp } from '../../lib/edge';
import { PatternMcpApiGatewayCloudFrontStack } from './stack';

patternApp('PatternMcpApiGatewayCloudFront', (app, id, props) => new PatternMcpApiGatewayCloudFrontStack(app, id, props));
