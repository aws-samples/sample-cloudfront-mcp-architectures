import { patternApp } from '../../lib/edge';
import { PatternMcpEksCloudFrontStack } from './stack';

patternApp('PatternMcpEksCloudFront', (app, id, props) => new PatternMcpEksCloudFrontStack(app, id, props));
