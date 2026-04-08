import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ovswtscpmnmkkxbueffg.supabase.co';
const supabaseAnonKey = 'sb_publishable_-vV9hVO-kY5nY5qPYrtn9w_eyFa8KgG';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
