import Async from 'async';
import querystring from 'querystring';
import 'babel-polyfill';
import doOptimizeFile from './image-optim';

const cleanKey = key => querystring.parse(`a=${key}`).a;

const handler = (event, context, callback) => {
  if (!(event && event.Records && event.Records.map)) {
    const err = new Error('Invalid Input Event', event);
    return callback(err);
  }
  const s3files = event.Records.map(record => ({
    bucket: record.s3.bucket.name,
    key: cleanKey(record.s3.object.key),
  })).filter(node => /\.(jpe?g|png|gif|svg|webp)$/.test(node.key));

  if (!(s3files && s3files.length)) {
    const err = new Error('No a supported image types - send in valid inputs', event);
    return callback(err);
  }

  const funcs = s3files.map(s3file => doOptimizeFile.bind(null, s3file));
  return Async.parallel(funcs, err => {
    if (err && err === 'skip') {
      return callback(null, 'skipped');
    }
    if (err) {
      return callback(err, 'errored');
    }
    return callback(null, 'success');
  });
};

export default handler;

