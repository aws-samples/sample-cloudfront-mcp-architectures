import { patternApp } from '../../lib/edge';
import { PatternMcpWebFunctionCloudFrontStack } from './stack';

patternApp('PatternMcpWebFunctionCloudFront', (app, id, props) => new PatternMcpWebFunctionCloudFrontStack(app, id, props));
